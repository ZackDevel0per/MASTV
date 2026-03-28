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

  private async login(): Promise<string> {
    const loginPage = await axios.get(`${this.baseUrl}/login`, {
      headers: BASE_HEADERS,
      httpsAgent: new (await import("https")).Agent({ rejectUnauthorized: false }),
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
    });

    const csrf = extractCsrf(loginPage.data);
    const setCookie = loginPage.headers["set-cookie"];
    const sessionCookie = Array.isArray(setCookie)
      ? setCookie.map((c: string) => c.split(";")[0]).join("; ")
      : "";

    const loginRes = await axios.post(
      `${this.baseUrl}/login`,
      new URLSearchParams({ _token: csrf ?? "", username: this.username, password: this.password }),
      {
        headers: {
          ...BASE_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: sessionCookie,
          Referer: `${this.baseUrl}/login`,
        },
        httpsAgent: new (await import("https")).Agent({ rejectUnauthorized: false }),
        maxRedirects: 0,
        validateStatus: (s) => s < 400,
      },
    );

    const allCookies = [
      ...(Array.isArray(loginPage.headers["set-cookie"]) ? loginPage.headers["set-cookie"] : []),
      ...(Array.isArray(loginRes.headers["set-cookie"]) ? loginRes.headers["set-cookie"] : []),
    ].map((c: string) => c.split(";")[0]).join("; ");

    this.cachedSession = { cookie: allCookies, expiresAt: Date.now() + this.SESSION_TTL_MS };
    return allCookies;
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
      const isDemo = planClave === "DEMO_1H" || planClave === "DEMO_3H";
      const username = isDemo
        ? `dem${telefono.replace(/\D/g, "")}`
        : await this.obtenerSiguienteUsername(usernamesEnUso);
      const password = `${this.prefix}${telefono.replace(/\D/g, "").slice(-6)}`;

      const isDemoHora = planClave === "DEMO_1H";
      const isDemoTres = planClave === "DEMO_3H";
      const duracionMinutos = isDemoHora ? 60 : isDemoTres ? 180 : undefined;

      const payload: Record<string, string> = {
        _token: csrf ?? "",
        username,
        password,
        package_id: String(planInfo.id),
        max_connections: String(planInfo.maxConexiones),
        bouquet: TODOS_LOS_BOUQUETS.join(","),
        is_trial: isDemoHora || isDemoTres ? "1" : "0",
      };

      if (duracionMinutos) {
        payload["trial_duration"] = String(duracionMinutos);
      }

      const storeRes = await axios.post(
        `${this.baseUrl}/lines/store-with-package`,
        new URLSearchParams(payload),
        {
          headers: {
            ...BASE_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookie,
            Referer: `${this.baseUrl}/lines/create-with-package`,
          },
          httpsAgent: agent,
          maxRedirects: 5,
          validateStatus: (s) => s < 500,
        },
      );

      if (storeRes.status >= 400) {
        return { ok: false, mensaje: `Error CRM al crear: HTTP ${storeRes.status}` };
      }

      const lineaInfo = await this.buscarLinea(username, cookie, agent);
      return {
        ok: true,
        usuario: username,
        contrasena: lineaInfo?.password ?? password,
        mensaje: "Cuenta creada exitosamente",
        plan: planInfo.nombre,
        servidor: lineaInfo?.servidor ?? `http://mtv.bo:80`,
      };
    } catch (err) {
      console.error(`[CRM][${this.username}] Error creando cuenta:`, err);
      return { ok: false, mensaje: err instanceof Error ? err.message : "Error desconocido en CRM" };
    }
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
      const usernameDemo = `dem${telefono.replace(/\D/g, "")}`;
      return lineas.some((l) => l.username?.toLowerCase() === usernameDemo.toLowerCase());
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
