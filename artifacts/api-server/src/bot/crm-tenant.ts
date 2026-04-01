/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║              SERVICIO CRM POR TENANT                                 ║
 * ║  Wrapper tenant-aware del CRM. Crea instancias configuradas         ║
 * ║  con las credenciales de cada cliente.                               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import axios from "axios";
import type { TenantConfig } from "./tenant-config.js";
import type { ResultadoCRM } from "./crm-service.js";
import { PLAN_ID_MAP } from "./crm-service.js";

export { PLAN_ID_MAP };

// Bouquets por defecto (todos los canales disponibles)
const TODOS_LOS_BOUQUETS = [
  "107","101","104","106","144","110","111","112","113","114",
  "115","116","117","118","119","120","121","122","123","124",
  "125","126","127","128","131","132","134","135","136","137",
  "138","139","140","142","143","102","145","146","141","147",
  "133","150","151","149","155","156","157","153","105","103",
  "161","129","108","109","130","152","158",
];

const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
};

function extractCsrf(html: string): string | null {
  return (
    html.match(/name="_token"\s+value="([^"]+)"/)?.[1] ??
    html.match(/<meta name="csrf-token" content="([^"]+)"/)?.[1] ??
    null
  );
}

function cookieFromHeaders(headers: Record<string, unknown>): string {
  const sc = headers["set-cookie"];
  if (!sc) return "";
  const arr = Array.isArray(sc) ? sc : [sc as string];
  return arr.map((c) => (c as string).split(";")[0]).join("; ");
}

export interface LineaCRM {
  username: string;
  password: string;
  server_url?: string;
  package_name?: string;
  created_at?: string;
  exp_date?: number;
  is_trial?: number;
  max_connections?: number;
}

/**
 * Clase CRM configurada para un tenant específico.
 * Mantiene su propia sesión cacheada y una lista actualizada cada 30 segundos.
 */
export class CrmService {
  private baseUrl: string;
  private username: string;
  private password: string;
  private prefix: string;
  private cachedSession: { cookie: string; expiresAt: number } | null = null;
  private readonly SESSION_TTL_MS = 18 * 60 * 1000;

  // ── Caché de líneas ──────────────────────────────────────────────────────
  private lineasCache: LineaCRM[] = [];
  private cacheActualizadoEn: number = 0;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private readonly POLLING_INTERVAL_MS = 30_000;

  constructor(tenant: TenantConfig) {
    this.baseUrl = tenant.crmBaseUrl;
    this.username = tenant.crmUsername ?? "";
    this.password = tenant.crmPassword ?? "";
    this.prefix = tenant.crmUsernamePrefix;
    this.iniciarPolling();
  }

  actualizarConfig(tenant: TenantConfig): void {
    this.baseUrl = tenant.crmBaseUrl;
    this.username = tenant.crmUsername ?? "";
    this.password = tenant.crmPassword ?? "";
    this.prefix = tenant.crmUsernamePrefix;
    this.cachedSession = null;
    this.detenerPolling();
    this.iniciarPolling();
  }

  isConfigured(): boolean {
    return !!(this.username && this.password);
  }

  // ── Polling de lista de líneas ───────────────────────────────────────────

  iniciarPolling(): void {
    if (!this.isConfigured()) return;
    // Carga inmediata al arrancar
    this.fetchLineas().then((lineas) => {
      this.lineasCache = lineas;
      this.cacheActualizadoEn = Date.now();
      console.log(`✅ [CRM][${this.username}] Caché inicial: ${lineas.length} líneas`);
    }).catch(() => {});

    this.pollingInterval = setInterval(async () => {
      try {
        const lineas = await this.fetchLineas();
        this.lineasCache = lineas;
        this.cacheActualizadoEn = Date.now();
        console.log(`🔄 [CRM][${this.username}] Caché actualizada: ${lineas.length} líneas`);
      } catch (err) {
        console.warn(`⚠️ [CRM][${this.username}] Error actualizando caché:`, err instanceof Error ? err.message : err);
      }
    }, this.POLLING_INTERVAL_MS);
  }

  detenerPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /** Devuelve la lista cacheada de líneas (actualizada cada 30 segundos) */
  getLineasCache(): LineaCRM[] {
    return this.lineasCache;
  }

  getCacheInfo(): { total: number; actualizadoHace: number } {
    return {
      total: this.lineasCache.length,
      actualizadoHace: this.cacheActualizadoEn ? Math.round((Date.now() - this.cacheActualizadoEn) / 1000) : -1,
    };
  }

  private async fetchLineas(): Promise<LineaCRM[]> {
    if (!this.isConfigured()) return [];
    const cookie = await this.getSession();
    const https = (await import("https")).default;
    const agent = new https.Agent({ rejectUnauthorized: false });
    const res = await axios.get(`${this.baseUrl}/api/line/list`, {
      headers: { ...BASE_HEADERS, Cookie: cookie, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      httpsAgent: agent,
      validateStatus: () => true,
      timeout: 15_000,
    });
    const raw = res.data;
    return Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  }

  private sessionValida(): boolean {
    return !!this.cachedSession && Date.now() < this.cachedSession.expiresAt;
  }

  private cookieFromHeaders(headers: Record<string, unknown>): string {
    const sc = headers["set-cookie"];
    if (!sc) return "";
    const arr = Array.isArray(sc) ? sc : [sc as string];
    return arr.map((c) => (c as string).split(";")[0]).join("; ");
  }

  private async login(): Promise<string> {
    const https = (await import("https")).default;
    const agent = new https.Agent({ rejectUnauthorized: false });

    // GET /login → CSRF + cookie inicial
    const loginPage = await axios.get(`${this.baseUrl}/login`, {
      headers: BASE_HEADERS,
      httpsAgent: agent,
      maxRedirects: 3,
      validateStatus: () => true,
    });

    const csrf = extractCsrf(loginPage.data);
    const cookieInicial = this.cookieFromHeaders(loginPage.headers as Record<string, unknown>);

    // POST /login → cookie autenticada
    const loginRes = await axios.post(
      `${this.baseUrl}/login`,
      new URLSearchParams({ _token: csrf ?? "", username: this.username, password: this.password }),
      {
        headers: {
          ...BASE_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieInicial,
          Referer: `${this.baseUrl}/login`,
        },
        httpsAgent: agent,
        maxRedirects: 0,
        validateStatus: () => true,
      },
    );

    let cookie = this.cookieFromHeaders(loginRes.headers as Record<string, unknown>) || cookieInicial;

    // Visitar /lines para establecer la sesión completamente (igual que bot legacy)
    const linesCheck = await axios.get(`${this.baseUrl}/lines`, {
      headers: { ...BASE_HEADERS, Cookie: cookie },
      httpsAgent: agent,
      maxRedirects: 3,
      validateStatus: () => true,
    });
    const cookieActualizado = this.cookieFromHeaders(linesCheck.headers as Record<string, unknown>);
    if (cookieActualizado) cookie = cookieActualizado;

    this.cachedSession = { cookie, expiresAt: Date.now() + this.SESSION_TTL_MS };
    return cookie;
  }

  private async getSession(): Promise<string> {
    if (!this.sessionValida()) {
      return this.login();
    }
    return this.cachedSession!.cookie;
  }

  /**
   * Obtiene el siguiente username disponible con el prefijo del tenant.
   * Usa la caché de líneas (actualizada cada 30 s) para evitar colisiones.
   */
  async obtenerSiguienteUsername(usernamesEnUso: Set<string>): Promise<string> {
    // Combinar la caché de líneas del CRM con el set pasado como argumento
    const usernamesCRM = new Set(
      this.lineasCache.map((l) => l.username?.toLowerCase()).filter(Boolean)
    );
    const todos = new Set([...usernamesEnUso, ...usernamesCRM]);

    for (let n = 1; n <= 99999; n++) {
      const candidato = `${this.prefix}${String(n).padStart(5, "0")}`;
      if (!todos.has(candidato.toLowerCase())) {
        return candidato;
      }
    }
    throw new Error(`No hay usernames disponibles con prefijo "${this.prefix}"`);
  }

  async crearCuenta(
    planClave: string,
    _nombreHint: string,
    _emailHint: string,
    telefono: string,
    usernamesEnUso: Set<string>,
  ): Promise<ResultadoCRM> {
    if (!this.isConfigured()) {
      return { ok: false, mensaje: "CRM no configurado para este tenant." };
    }

    const planInfo = PLAN_ID_MAP[planClave];
    if (!planInfo) {
      return { ok: false, mensaje: `Plan desconocido: ${planClave}` };
    }

    for (let intento = 1; intento <= 2; intento++) {
      try {
        const cookie = await this.getSession();
        const https = (await import("https")).default;
        const agent = new https.Agent({ rejectUnauthorized: false });

        // 1. Usar la caché como snapshot "antes" (actualizada cada 30 s)
        const lineasAntes = this.lineasCache.length > 0
          ? this.lineasCache
          : await this.fetchLineas();
        const usernamesAntes = new Set(lineasAntes.map((l) => l.username?.toLowerCase()));
        console.log(`   [CRM][${this.username}] Antes (caché): ${lineasAntes.length} líneas`);

        // 2. Obtener CSRF de la página de creación
        const createPage = await axios.get(`${this.baseUrl}/lines/create-with-package`, {
          headers: { ...BASE_HEADERS, Cookie: cookie },
          httpsAgent: agent,
          validateStatus: (s) => s < 400,
        });

        const csrf = extractCsrf(createPage.data);
        if (!csrf) {
          console.warn(`[CRM][${this.username}] Sin CSRF en create-with-package (intento ${intento}), reconectando...`);
          this.cachedSession = null;
          if (intento < 2) { await new Promise(r => setTimeout(r, 2000)); continue; }
          return { ok: false, mensaje: "No se pudo obtener CSRF del CRM" };
        }

        const isDemo = planClave === "DEMO_1H" || planClave === "DEMO_3H";
        const username = isDemo
          ? telefono.replace(/\D/g, "")
          : await this.obtenerSiguienteUsername(usernamesEnUso);

        // Mismo formato exacto que el legacy que funciona
        const bodyParams = new URLSearchParams();
        bodyParams.append("_method", "POST");
        bodyParams.append("_token", csrf);
        bodyParams.append("package", String(planInfo.id));
        bodyParams.append("username", username);
        for (const bid of TODOS_LOS_BOUQUETS) {
          bodyParams.append("bouquet_ids[]", bid);
        }

        console.log(`📝 [CRM][${this.username}] Creando cuenta plan=${planClave} username=${username} intento=${intento}`);

        // 3. Crear la cuenta
        const storeRes = await axios.post(
          `${this.baseUrl}/lines/store-with-package`,
          bodyParams.toString(),
          {
            headers: {
              ...BASE_HEADERS,
              "Content-Type": "application/x-www-form-urlencoded",
              Origin: this.baseUrl,
              Referer: `${this.baseUrl}/lines/create-with-package`,
              Cookie: cookie,
            },
            httpsAgent: agent,
            maxRedirects: 0,
            validateStatus: () => true,
          },
        );

        // Actualizar cookie con la del POST (igual que en legacy)
        const cookiePost = cookieFromHeaders(storeRes.headers as Record<string, unknown>) || cookie;
        this.cachedSession = { cookie: cookiePost, expiresAt: Date.now() + this.SESSION_TTL_MS };

        console.log(`   [CRM][${this.username}] store-with-package → HTTP ${storeRes.status} location=${storeRes.headers["location"] ?? "—"}`);

        if (storeRes.status !== 302 && storeRes.status !== 200) {
          if (intento < 2) { this.cachedSession = null; await new Promise(r => setTimeout(r, 2000)); continue; }
          return { ok: false, mensaje: `Error CRM al crear: HTTP ${storeRes.status}` };
        }

        // Si redirige de vuelta a create-with-package = falló la creación (validación CRM)
        const location = storeRes.headers["location"] as string ?? "";
        if (location.includes("create-with-package")) {
          console.error(`❌ [CRM][${this.username}] CRM rechazó la creación (redirigió a formulario)`);
          return { ok: false, mensaje: "El CRM rechazó la creación de la cuenta" };
        }

        // 4. Esperar brevemente y obtener lista DESPUÉS (usando cookie actualizada)
        await new Promise(r => setTimeout(r, 1500));

        const lineasDespues = await this.fetchLineas();
        // Actualizar la caché con la lista fresca post-creación
        this.lineasCache = lineasDespues;
        this.cacheActualizadoEn = Date.now();
        console.log(`   [CRM][${this.username}] Después: ${lineasDespues.length} líneas (caché actualizada)`);

        // 5. La cuenta nueva = la que aparece en DESPUÉS pero no en ANTES
        const lineaNueva = lineasDespues.find((l) => !usernamesAntes.has(l.username?.toLowerCase()));

        if (lineaNueva) {
          console.log(`✅ [CRM][${this.username}] Cuenta nueva encontrada: ${lineaNueva.username}`);
          return {
            ok: true,
            usuario: lineaNueva.username,
            contrasena: lineaNueva.password,
            mensaje: "Cuenta creada exitosamente",
            plan: planInfo.nombre,
            servidor: (lineaNueva.server_url as string) ?? `http://mtv.bo:80`,
          };
        }

        // Intentar también por username exacto (por si ya estaba en la lista)
        const lineaExacta = lineasDespues.find((l) => l.username?.toLowerCase() === username.toLowerCase());
        if (lineaExacta) {
          console.log(`✅ [CRM][${this.username}] Cuenta encontrada por username: ${lineaExacta.username}`);
          return {
            ok: true,
            usuario: lineaExacta.username,
            contrasena: lineaExacta.password,
            mensaje: "Cuenta creada exitosamente",
            plan: planInfo.nombre,
            servidor: (lineaExacta.server_url as string) ?? `http://mtv.bo:80`,
          };
        }

        console.error(`❌ [CRM][${this.username}] Cuenta no encontrada en lista después de crearla`);
        return { ok: false, mensaje: "No se pudo recuperar las credenciales de la cuenta creada" };

      } catch (err) {
        console.error(`[CRM][${this.username}] Error creando cuenta (intento ${intento}):`, err);
        if (intento < 2) { this.cachedSession = null; await new Promise(r => setTimeout(r, 2000)); continue; }
        return { ok: false, mensaje: err instanceof Error ? err.message : "Error desconocido en CRM" };
      }
    }
    return { ok: false, mensaje: "No se pudo crear la cuenta después de 2 intentos" };
  }

  async renovarCuenta(usuarioCRM: string, planClave: string): Promise<ResultadoCRM> {
    if (!this.isConfigured()) {
      return { ok: false, mensaje: "CRM no configurado para este tenant." };
    }

    const planInfo = PLAN_ID_MAP[planClave];
    if (!planInfo) {
      return { ok: false, mensaje: `Plan desconocido: ${planClave}` };
    }

    try {
      const cookie = await this.getSession();
      const https = (await import("https")).default;
      const agent = new https.Agent({ rejectUnauthorized: false });

      const listRes = await axios.get(`${this.baseUrl}/api/line/list`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
        httpsAgent: agent,
        validateStatus: (s) => s < 400,
      });

      const lineas: Array<{ username: string; id: number; password: string; [k: string]: unknown }> =
        listRes.data?.data ?? listRes.data ?? [];

      const linea = lineas.find(
        (l) => l.username?.toLowerCase() === usuarioCRM.toLowerCase(),
      );

      if (!linea) {
        return { ok: false, mensaje: `Usuario "${usuarioCRM}" no encontrado en CRM` };
      }

      const editPage = await axios.get(`${this.baseUrl}/lines/${linea.id}/edit`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
        httpsAgent: agent,
        validateStatus: (s) => s < 400,
      });

      const csrf = extractCsrf(editPage.data);

      const renewPayload = new URLSearchParams({
        _token: csrf ?? "",
        _method: "PUT",
        package_id: String(planInfo.id),
        max_connections: String(planInfo.maxConexiones),
        bouquet: TODOS_LOS_BOUQUETS.join(","),
      });

      const renewRes = await axios.post(
        `${this.baseUrl}/lines/${linea.id}`,
        renewPayload,
        {
          headers: {
            ...BASE_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookie,
            Referer: `${this.baseUrl}/lines/${linea.id}/edit`,
          },
          httpsAgent: agent,
          maxRedirects: 5,
          validateStatus: (s) => s < 500,
        },
      );

      if (renewRes.status >= 400) {
        return { ok: false, mensaje: `Error CRM al renovar: HTTP ${renewRes.status}` };
      }

      const lineaActualizada = await this.buscarLinea(usuarioCRM, cookie, agent);
      return {
        ok: true,
        usuario: usuarioCRM,
        contrasena: lineaActualizada?.password ?? String(linea.password),
        mensaje: "Cuenta renovada exitosamente",
        plan: planInfo.nombre,
        servidor: lineaActualizada?.servidor ?? `http://mtv.bo:80`,
      };
    } catch (err) {
      console.error(`[CRM][${this.username}] Error renovando cuenta:`, err);
      return { ok: false, mensaje: err instanceof Error ? err.message : "Error desconocido en CRM" };
    }
  }

  async verificarDemoExistente(telefono: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const cookie = await this.getSession();
      const https = (await import("https")).default;
      const agent = new https.Agent({ rejectUnauthorized: false });
      const listRes = await axios.get(`${this.baseUrl}/api/line/list`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
        httpsAgent: agent,
        validateStatus: (s) => s < 400,
      });
      const lineas: Array<{ username: string }> = listRes.data?.data ?? listRes.data ?? [];
      const telLimpio = telefono.replace(/\D/g, "");
      return lineas.some((l) => l.username?.toLowerCase() === telLimpio.toLowerCase());
    } catch {
      return false;
    }
  }

  async consultarEstadoCuenta(usuarioCRM: string): Promise<{
    ok: boolean;
    usuario?: string;
    plan?: string;
    maxConexiones?: number;
    diasRestantes?: number;
    fechaExpiracion?: string;
    esPrueba?: boolean;
    mensaje: string;
  }> {
    if (!this.isConfigured()) {
      return { ok: false, mensaje: "CRM no configurado." };
    }
    try {
      // Usar la caché si está disponible; si no, hacer fetch fresco
      const lineas = this.lineasCache.length > 0 ? this.lineasCache : await this.fetchLineas();

      const linea = lineas.find(
        (l) => l.username?.toLowerCase() === usuarioCRM.toLowerCase(),
      );

      if (!linea) {
        return { ok: false, mensaje: `Usuario "${usuarioCRM}" no encontrado.` };
      }

      let diasRestantes: number | undefined;
      let fechaExpiracion: string | undefined;
      if (linea.exp_date) {
        const expMs = linea.exp_date * 1000;
        const ahora = Date.now();
        diasRestantes = Math.ceil((expMs - ahora) / 86_400_000);
        fechaExpiracion = new Date(expMs).toLocaleDateString("es-BO", { timeZone: "America/La_Paz" });
      }

      return {
        ok: true,
        usuario: linea.username,
        plan: linea.package_name,
        maxConexiones: linea.max_connections,
        diasRestantes,
        fechaExpiracion,
        esPrueba: linea.is_trial === 1,
        mensaje: "Cuenta encontrada",
      };
    } catch (err) {
      return { ok: false, mensaje: err instanceof Error ? err.message : "Error consultando CRM" };
    }
  }

  async obtenerTodasLasLineas(): Promise<Array<{
    username: string;
    password: string;
    planNombre: string;
    fechaCreacion: string;
    fechaExpiracion: string;
    estado: string;
  }>> {
    if (!this.isConfigured()) return [];
    // Usar la caché si está disponible; si no, hacer fetch
    const lineas = this.lineasCache.length > 0 ? this.lineasCache : await this.fetchLineas();
    return lineas.map((l) => ({
      username: l.username ?? "",
      password: l.password ?? "",
      planNombre: l.package_name ?? "",
      fechaCreacion: l.created_at ?? "",
      fechaExpiracion: l.exp_date
        ? new Date(l.exp_date * 1000).toLocaleDateString("es-BO", { timeZone: "America/La_Paz" })
        : "",
      estado: l.is_trial ? "PRUEBA" : "ACTIVA",
    }));
  }

  private async buscarLinea(
    username: string,
    _cookie: string,
    _agent: unknown,
  ): Promise<{ password: string; servidor: string } | null> {
    try {
      // Usar la caché; si está vacía, hacer fetch
      const lineas = this.lineasCache.length > 0 ? this.lineasCache : await this.fetchLineas();
      const linea = lineas.find((l) => l.username?.toLowerCase() === username.toLowerCase());
      if (!linea) return null;
      return {
        password: linea.password ?? "",
        servidor: (linea.server_url as string) ?? `http://mtv.bo:80`,
      };
    } catch {
      return null;
    }
  }
}
