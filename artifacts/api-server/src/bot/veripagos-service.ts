/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                    VERIPAGOS SERVICE                                 ║
 * ║  Integración con veripagos.com para generación y verificación        ║
 * ║  automática de QR de pago por tenant.                                ║
 * ║                                                                      ║
 * ║  Flujo:                                                              ║
 * ║  1. login()  → obtiene session cookies + CSRF token                  ║
 * ║  2. generarQR() → POST /generar-qr → base64 PNG + movimiento_id     ║
 * ║  3. verificarQR() → POST /verificar-qr → "pagado" | "pendiente"     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import axios, { type AxiosInstance } from "axios";

const BASE_URL = "https://veripagos.com";

export type VerifStatus = "pagado" | "pendiente" | "error";

export interface QRGenerado {
  qrBase64: string;
  movimientoId: string;
  expiry: Date;
}

/**
 * Calcula el campo `vencimiento` que espera la API de VeriPagos.
 * Formato: "D/HH:MM" donde D=días, HH=horas, MM=minutos desde ahora hasta expiry.
 */
function calcVencimiento(expiry: Date): string {
  const now = new Date();
  let diffMs = expiry.getTime() - now.getTime();
  if (diffMs < 0) diffMs = 0;
  const diffTotalMins = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(diffTotalMins / (24 * 60));
  const remMins = diffTotalMins % (24 * 60);
  const hours = Math.floor(remMins / 60);
  const mins = remMins % 60;
  return `${days}/${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export class VeriPagosService {
  private readonly username: string;
  private readonly password: string;
  private cookies: string = "";
  private csrfToken: string = "";
  private loggedIn = false;
  private readonly http: AxiosInstance;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
      },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });
  }

  // ── Cookie management ───────────────────────────────────────────────────────

  private mergeCookies(newHeaders: Record<string, any>): void {
    const setCookie = newHeaders["set-cookie"] as string[] | string | undefined;
    if (!setCookie) return;
    const cookieMap = new Map<string, string>();
    for (const part of this.cookies.split("; ")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx > 0) cookieMap.set(part.slice(0, eqIdx).trim(), part.slice(eqIdx + 1).trim());
    }
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const cookieStr of list) {
      const pair = cookieStr.split(";")[0];
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) cookieMap.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
    }
    this.cookies = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private extractCsrf(html: string): string | null {
    const match = html.match(/<input[^>]+name="_token"[^>]+value="([^"]+)"/);
    if (match) return match[1];
    const match2 = html.match(/name="_token"\s+value="([^"]+)"/);
    return match2?.[1] ?? null;
  }

  // ── Login ───────────────────────────────────────────────────────────────────

  async login(): Promise<void> {
    // 1. GET /login — obtener CSRF + cookies iniciales
    const loginPage = await this.http.get("/login", {
      headers: { Cookie: this.cookies },
    });
    this.mergeCookies(loginPage.headers);
    const csrf = this.extractCsrf(loginPage.data as string);
    if (!csrf) throw new Error("[VeriPagos] No se pudo extraer CSRF del formulario de login");
    this.csrfToken = csrf;

    // 2. POST /login — enviar credenciales
    const params = new URLSearchParams();
    params.set("_token", this.csrfToken);
    params.set("username", this.username);
    params.set("password", this.password);

    const loginResp = await this.http.post("/login", params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: this.cookies,
        Referer: `${BASE_URL}/login`,
      },
      maxRedirects: 5,
    });
    this.mergeCookies(loginResp.headers);

    // Detectar login fallido: la página de login sigue presente (contiene el formulario)
    const htmlResp = typeof loginResp.data === "string" ? loginResp.data : "";
    const stillOnLogin = htmlResp.includes('name="username"') || htmlResp.includes("id=\"password\"") || htmlResp.includes("Iniciar Sesión");
    if (stillOnLogin) {
      const snippet = htmlResp.slice(0, 300).replace(/\s+/g, " ");
      console.error(`[VeriPagos] Respuesta login (primeros 300 chars): ${snippet}`);
      throw new Error("[VeriPagos] Login fallido — credenciales incorrectas o captcha");
    }

    // 3. GET /qr/generar — obtener CSRF fresco para las operaciones de QR
    const qrPage = await this.http.get("/qr/generar", {
      headers: { Cookie: this.cookies },
    });
    this.mergeCookies(qrPage.headers);
    const freshCsrf = this.extractCsrf(qrPage.data as string);
    if (freshCsrf) this.csrfToken = freshCsrf;

    this.loggedIn = true;
    console.log(`✅ [VeriPagos] Login exitoso para ${this.username}`);
  }

  private async ensureLoggedIn(): Promise<void> {
    if (!this.loggedIn) await this.login();
  }

  private async postConReintento(endpoint: string, params: URLSearchParams): Promise<any> {
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: this.cookies,
      Referer: `${BASE_URL}/qr/generar`,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
    };

    let resp = await this.http.post(endpoint, params.toString(), { headers });
    this.mergeCookies(resp.headers);

    // Si la sesión expiró (redirigió a login o devolvió HTML en vez de JSON)
    if (resp.status === 302 || resp.status === 401 ||
        (typeof resp.data === "string" && (resp.data as string).includes("<!DOCTYPE"))) {
      console.log(`[VeriPagos] Sesión expirada, re-login...`);
      this.loggedIn = false;
      await this.login();
      params.set("_token", this.csrfToken);
      resp = await this.http.post(endpoint, params.toString(), {
        headers: { ...headers, Cookie: this.cookies },
      });
      this.mergeCookies(resp.headers);
    }

    return resp.data;
  }

  // ── Generar QR ──────────────────────────────────────────────────────────────

  /**
   * Genera un QR de pago único en VeriPagos.
   * El QR expirará al día siguiente a las 23:59.
   * @param monto   Monto en la moneda del tenant (Bs)
   * @param detalle Descripción del pago (ej: "Plan 1D1M - bot IPTV")
   */
  async generarQR(monto: number, detalle: string): Promise<QRGenerado> {
    await this.ensureLoggedIn();

    // Expiry: mañana a las 23:59:00
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 1);
    expiry.setHours(23, 59, 0, 0);
    const vencimiento = calcVencimiento(expiry);

    const params = new URLSearchParams();
    params.set("_token", this.csrfToken);
    params.set("monto_qr", String(monto));
    params.set("detalle", detalle);
    params.set("uso_unico", "on");
    params.set("vencimiento", vencimiento);

    const data = await this.postConReintento("/generar-qr", params);

    // La API devuelve { Codigo, Mensaje, Data: { qr: base64, movimiento_id } }
    if (!data?.Data?.qr || !data?.Data?.movimiento_id) {
      throw new Error(`[VeriPagos] generarQR falló: ${data?.Mensaje ?? JSON.stringify(data)}`);
    }

    return {
      qrBase64: data.Data.qr as string,
      movimientoId: String(data.Data.movimiento_id),
      expiry,
    };
  }

  // ── Verificar QR ─────────────────────────────────────────────────────────────

  /**
   * Verifica el estado de pago de un movimiento.
   * Codigo 0 = pagado, 1 = pendiente, 2 = error/expirado
   */
  async verificarQR(movimientoId: string): Promise<VerifStatus> {
    await this.ensureLoggedIn();

    const params = new URLSearchParams();
    params.set("_token", this.csrfToken);
    params.set("movimiento_id", movimientoId);

    const data = await this.postConReintento("/verificar-qr", params);

    if (data?.Codigo === 0) return "pagado";
    if (data?.Codigo === 1) return "pendiente";
    return "error";
  }
}
