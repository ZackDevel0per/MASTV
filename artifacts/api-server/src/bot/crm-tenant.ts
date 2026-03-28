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
  const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * Clase CRM configurada para un tenant específico.
 * Mantiene su propia sesión cacheada.
 */
export class CrmService {
  private baseUrl: string;
  private username: string;
  private password: string;
  private prefix: string;
  private cachedSession: { cookie: string; expiresAt: number } | null = null;
  private readonly SESSION_TTL_MS = 18 * 60 * 1000;

  constructor(tenant: TenantConfig) {
    this.baseUrl = tenant.crmBaseUrl;
    this.username = tenant.crmUsername ?? "";
    this.password = tenant.crmPassword ?? "";
    this.prefix = tenant.crmUsernamePrefix;
  }

  isConfigured(): boolean {
    return !!(this.username && this.password);
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
   * Consulta directamente el CRM.
   */
  async obtenerSiguienteUsername(usernamesEnUso: Set<string>): Promise<string> {
    for (let n = 1; n <= 99999; n++) {
      const candidato = `${this.prefix}${String(n).padStart(5, "0")}`;
      if (!usernamesEnUso.has(candidato.toLowerCase())) {
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

        const isDemoHora = planClave === "DEMO_1H";
        const isDemoTres = planClave === "DEMO_3H";
        const duracionMinutos = isDemoHora ? 60 : isDemoTres ? 180 : undefined;

        const bodyParams = new URLSearchParams();
        bodyParams.append("_token", csrf);
        bodyParams.append("username", username);
        bodyParams.append("package_id", String(planInfo.id));
        bodyParams.append("max_connections", String(planInfo.maxConexiones));
        bodyParams.append("is_trial", isDemoHora || isDemoTres ? "1" : "0");
        if (duracionMinutos) bodyParams.append("trial_duration", String(duracionMinutos));
        for (const bid of TODOS_LOS_BOUQUETS) {
          bodyParams.append("bouquet_ids[]", bid);
        }

        console.log(`📝 [CRM][${this.username}] Creando cuenta plan=${planClave} username=${username} intento=${intento}`);

        const storeRes = await axios.post(
          `${this.baseUrl}/lines/store-with-package`,
          bodyParams,
          {
            headers: {
              ...BASE_HEADERS,
              "Content-Type": "application/x-www-form-urlencoded",
              Cookie: cookie,
              Referer: `${this.baseUrl}/lines/create-with-package`,
            },
            httpsAgent: agent,
            maxRedirects: 0,
            validateStatus: () => true,
          },
        );

        console.log(`   [CRM][${this.username}] store-with-package → HTTP ${storeRes.status}`);

        if (storeRes.status !== 302 && storeRes.status !== 200) {
          if (intento < 2) { this.cachedSession = null; await new Promise(r => setTimeout(r, 2000)); continue; }
          return { ok: false, mensaje: `Error CRM al crear: HTTP ${storeRes.status}` };
        }

        // Esperar brevemente para que el CRM registre la cuenta
        await new Promise(r => setTimeout(r, 1500));

        // Usar la cookie de sesión original para consultar la lista
        // (la del 302 puede no tener la sesión completa)
        const listRes = await axios.get(`${this.baseUrl}/api/line/list`, {
          headers: { ...BASE_HEADERS, Cookie: cookie, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
          httpsAgent: agent,
          validateStatus: () => true,
        });

        const rawData = listRes.data;
        const lineas: Array<{ username: string; password: string; server_url?: string }> =
          Array.isArray(rawData) ? rawData : Array.isArray(rawData?.data) ? rawData.data : [];

        console.log(`   [CRM][${this.username}] line/list → ${lineas.length} líneas`);

        const linea = lineas.find((l) => l.username?.toLowerCase() === username.toLowerCase());

        if (linea) {
          console.log(`✅ [CRM][${this.username}] Línea encontrada: ${linea.username} pass=${linea.password}`);
          return {
            ok: true,
            usuario: linea.username,
            contrasena: linea.password,
            mensaje: "Cuenta creada exitosamente",
            plan: planInfo.nombre,
            servidor: (linea.server_url as string) ?? `http://mtv.bo:80`,
          };
        }

        // Fallback: usar la línea más reciente si no hay match exacto
        console.warn(`⚠️ [CRM][${this.username}] Username ${username} no encontrado exacto, usando primera línea`);
        const primera = lineas[0];
        if (primera?.username) {
          return {
            ok: true,
            usuario: primera.username,
            contrasena: primera.password,
            mensaje: "Cuenta creada exitosamente",
            plan: planInfo.nombre,
            servidor: (primera.server_url as string) ?? `http://mtv.bo:80`,
          };
        }

        return { ok: false, mensaje: "Cuenta creada en CRM pero no se pudo recuperar las credenciales" };

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
      const cookie = await this.getSession();
      const https = (await import("https")).default;
      const agent = new https.Agent({ rejectUnauthorized: false });
      const listRes = await axios.get(`${this.baseUrl}/api/line/list`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
        httpsAgent: agent,
        validateStatus: (s) => s < 400,
      });
      const lineas: Array<{
        username: string;
        password: string;
        package_name?: string;
        max_connections?: number;
        exp_date?: number;
        is_trial?: number;
      }> = listRes.data?.data ?? listRes.data ?? [];

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
    try {
      const cookie = await this.getSession();
      const https = (await import("https")).default;
      const agent = new https.Agent({ rejectUnauthorized: false });
      const listRes = await axios.get(`${this.baseUrl}/api/line/list`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
        httpsAgent: agent,
        validateStatus: (s) => s < 400,
      });
      const lineas: Array<{
        username: string;
        password: string;
        package_name?: string;
        created_at?: string;
        exp_date?: number;
        is_trial?: number;
      }> = listRes.data?.data ?? listRes.data ?? [];

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
    } catch {
      return [];
    }
  }

  private async buscarLinea(
    username: string,
    cookie: string,
    agent: unknown,
  ): Promise<{ password: string; servidor: string } | null> {
    try {
      const listRes = await axios.get(`${this.baseUrl}/api/line/list`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
        httpsAgent: agent,
        validateStatus: (s) => s < 400,
      });
      const lineas: Array<{ username: string; password: string; server_url?: string }> =
        listRes.data?.data ?? listRes.data ?? [];
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
