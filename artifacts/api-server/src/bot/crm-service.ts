/**
 * SERVICIO CRM - resellermastv.com:8443
 * Flujo verificado:
 *  1. GET /login → CSRF + cookie
 *  2. POST /login → cookie autenticada (302)
 *  3. GET /lines/create-with-package → CSRF fresco
 *  4. POST /lines/store-with-package → línea creada (302)
 *  5. GET /api/line/list → buscar línea por username → retornar credenciales
 */

import axios from "axios";

const CRM_BASE_URL = "https://resellermastv.com:8443";
const CRM_USERNAME = "Zack";
const CRM_PASSWORD = "ZackDeveloper7889";
const SESSION_TTL_MS = 18 * 60 * 1000; // 18 min (sesión dura 20 min en el CRM)

// Todos los bouquets disponibles (canales, series, películas, etc.)
// Los marcados como adultos (+18) se incluyen también; el CRM ya los clasifica aparte.
const TODOS_LOS_BOUQUETS = [
  "107",
  "101",
  "104",
  "106",
  "144",
  "110",
  "111",
  "112",
  "113",
  "114",
  "115",
  "116",
  "117",
  "118",
  "119",
  "120",
  "121",
  "122",
  "123",
  "124",
  "125",
  "126",
  "127",
  "128",
  "131",
  "132",
  "134",
  "135",
  "136",
  "137",
  "138",
  "139",
  "140",
  "142",
  "143",
  "102",
  "145",
  "146",
  "141",
  "147",
  "133",
  "150",
  "151",
  "149",
  "155",
  "156",
  "157",
  "153",
  "105",
  "103",
  "161",
  "129",
  "108",
  "109",
  "130",
  "152",
  "158",
];

export const PLAN_ID_MAP: Record<
  string,
  { id: number; nombre: string; precio: string; monto: number }
> = {
  DEMO_1H: { id: 101, nombre: "DEMO 1 HORA",             precio: "Gratis", monto: 0   },
  DEMO_3H: { id: 102, nombre: "DEMO 3 HORAS",            precio: "Gratis", monto: 0   },
  P1:      { id: 107, nombre: "1 MES - 1 DISPOSITIVO",   precio: "29 Bs",  monto: 29  },
  P2:      { id: 109, nombre: "3 MESES - 1 DISPOSITIVO", precio: "82 Bs",  monto: 82  },
  P3:      { id: 111, nombre: "6 MESES - 1 DISPOSITIVO", precio: "155 Bs", monto: 155 },
  P4:      { id: 113, nombre: "12 MESES - 1 DISPOSITIVO",precio: "300 Bs", monto: 300 },
  Q1:      { id: 108, nombre: "1 MES - 2 DISPOSITIVOS",  precio: "35 Bs",  monto: 35  },
  Q2:      { id: 110, nombre: "3 MESES - 2 DISPOSITIVOS",precio: "100 Bs", monto: 100 },
  Q3:      { id: 112, nombre: "6 MESES - 2 DISPOSITIVOS",precio: "190 Bs", monto: 190 },
  Q4:      { id: 114, nombre: "12 MESES - 2 DISPOSITIVOS",precio: "380 Bs",monto: 380 },
  R1:      { id: 103, nombre: "1 MES - 3 DISPOSITIVOS",  precio: "40 Bs",  monto: 40  },
  R2:      { id: 104, nombre: "3 MESES - 3 DISPOSITIVOS",precio: "115 Bs", monto: 115 },
  R3:      { id: 105, nombre: "6 MESES - 3 DISPOSITIVOS",precio: "225 Bs", monto: 225 },
  R4:      { id: 106, nombre: "12 MESES - 3 DISPOSITIVOS",precio: "440 Bs",monto: 440 },
};

export interface ResultadoCRM {
  ok: boolean;
  usuario?: string;
  contrasena?: string;
  mensaje: string;
  plan?: string;
  servidor?: string;
}

// ── Caché de sesión ────────────────────────────────────────────────────────────
let cachedSession: { cookie: string; expiresAt: number } | null = null;

function sessionValida(): boolean {
  return !!cachedSession && Date.now() < cachedSession.expiresAt;
}

// ── Helpers HTTP ───────────────────────────────────────────────────────────────
const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9",
};

function cookieFromHeaders(headers: Record<string, unknown>): string {
  const sc = headers["set-cookie"];
  if (!sc) return "";
  const arr = Array.isArray(sc) ? sc : [sc as string];
  return arr.map((c) => (c as string).split(";")[0]).join("; ");
}

function csrfFromHtml(html: string): string {
  return (
    html.match(/name="_token"\s+value="([^"]+)"/)?.[1] ??
    html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1] ??
    ""
  );
}

// ── Login ──────────────────────────────────────────────────────────────────────
async function loginCRM(): Promise<string> {
  console.log("🔐 [CRM] Iniciando sesión...");

  // 1. GET /login → CSRF + cookie de sesión inicial
  const r1 = await axios.get(`${CRM_BASE_URL}/login`, {
    headers: BASE_HEADERS,
    maxRedirects: 3,
    validateStatus: () => true,
    timeout: 15_000,
  });
  const cookieInicial = cookieFromHeaders(
    r1.headers as Record<string, unknown>,
  );
  const csrf1 = csrfFromHtml(r1.data as string);
  if (!csrf1) throw new Error("No se encontró CSRF en /login");
  if (!cookieInicial) throw new Error("No se obtuvo cookie de /login");

  // 2. POST /login → cookie autenticada (302 → dashboard)
  const r2 = await axios.post(
    `${CRM_BASE_URL}/login`,
    new URLSearchParams({
      _token: csrf1,
      username: CRM_USERNAME,
      password: CRM_PASSWORD,
    }).toString(),
    {
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: CRM_BASE_URL,
        Referer: `${CRM_BASE_URL}/login`,
        Cookie: cookieInicial,
      },
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
      timeout: 15_000,
    },
  );
  const cookieAuth = cookieFromHeaders(r2.headers as Record<string, unknown>);
  if (!cookieAuth) throw new Error("Login fallido: sin cookie autenticada");

  console.log("✅ [CRM] Sesión iniciada");
  return cookieAuth;
}

/** Obtener cookie de sesión (reutiliza si sigue vigente) */
async function getSession(): Promise<string> {
  if (sessionValida()) {
    console.log("♻️  [CRM] Reutilizando sesión en caché");
    return cachedSession!.cookie;
  }
  let cookie = await loginCRM();

  // Visitar /lines para que el servidor establezca la sesión completamente
  const check = await axios.get(`${CRM_BASE_URL}/lines`, {
    headers: { ...BASE_HEADERS, Cookie: cookie },
    maxRedirects: 3,
    validateStatus: () => true,
    timeout: 12_000,
  });
  const cookieUpdated = cookieFromHeaders(
    check.headers as Record<string, unknown>,
  );
  if (cookieUpdated) cookie = cookieUpdated;

  cachedSession = { cookie, expiresAt: Date.now() + SESSION_TTL_MS };
  return cookie;
}

// ── Crear línea ────────────────────────────────────────────────────────────────
export async function crearCuentaEnCRM(
  planComando: string,
  _clienteNombre: string,
  _clienteEmail: string,
  clienteTelefono: string,
): Promise<ResultadoCRM> {
  const planInfo = PLAN_ID_MAP[planComando.toUpperCase()];
  if (!planInfo) {
    return { ok: false, mensaje: `Plan no reconocido: ${planComando}` };
  }

  for (let intento = 1; intento <= 2; intento++) {
    try {
      console.log(
        `📝 [CRM] Creando cuenta plan=${planComando} intento=${intento}`,
      );

      const sessionCookie = await getSession();

      // 3. GET /lines/create-with-package → CSRF fresco (la sesión web requiere token fresco por página)
      const r3 = await axios.get(`${CRM_BASE_URL}/lines/create-with-package`, {
        headers: { ...BASE_HEADERS, Cookie: sessionCookie },
        maxRedirects: 2,
        validateStatus: () => true,
        timeout: 15_000,
      });

      const csrf3 = csrfFromHtml(r3.data as string);

      // Si no hay CSRF en la página, probablemente redirigió al login
      if (!csrf3 || r3.status === 302) {
        console.warn(
          "⚠️  [CRM] Sesión expirada (sin CSRF en create-with-package), reconectando...",
        );
        cachedSession = null;
        continue;
      }

      // Para demos: username determinístico basado en teléfono (Dzk + número)
      // Para planes pagados: zk + número de teléfono completo
      const esDemo = planComando.toUpperCase().startsWith("DEMO");
      let username: string;
      if (esDemo) {
        username = getDemoUsername(clienteTelefono);
      } else {
        const tel = clienteTelefono.replace(/\D/g, "");
        username = `zk${tel}`;
      }

      // 4. POST /lines/store-with-package → crea la línea (302 si OK)
      // Construimos el body con URLSearchParams para soportar bouquet_ids[] múltiples
      const bodyParams = new URLSearchParams();
      bodyParams.append("_method", "POST");
      bodyParams.append("_token", csrf3);
      bodyParams.append("package", String(planInfo.id));
      bodyParams.append("username", username);
      for (const bid of TODOS_LOS_BOUQUETS) {
        bodyParams.append("bouquet_ids[]", bid);
      }

      const r4 = await axios.post(
        `${CRM_BASE_URL}/lines/store-with-package`,
        bodyParams.toString(),
        {
          headers: {
            ...BASE_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: CRM_BASE_URL,
            Referer: `${CRM_BASE_URL}/lines/create-with-package`,
            Cookie: sessionCookie,
          },
          maxRedirects: 0,
          validateStatus: () => true,
          timeout: 20_000,
        },
      );

      // Cookie actualizada tras el POST (puede tener flash)
      const cookiePost =
        cookieFromHeaders(r4.headers as Record<string, unknown>) ||
        sessionCookie;
      // Refrescar caché con la cookie más nueva
      cachedSession = {
        cookie: cookiePost,
        expiresAt: Date.now() + SESSION_TTL_MS,
      };

      console.log(`   [CRM] store-with-package → HTTP ${r4.status}`);

      if (r4.status !== 302 && r4.status !== 200) {
        throw new Error(`HTTP inesperado al crear línea: ${r4.status}`);
      }

      // 5. GET /api/line/list → buscar línea por username
      const r5 = await axios.get(`${CRM_BASE_URL}/api/line/list`, {
        headers: {
          ...BASE_HEADERS,
          Cookie: cookiePost,
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        validateStatus: () => true,
        timeout: 15_000,
      });

      // El endpoint puede devolver array plano O {rowCount, rowTotal, data:[...]}
      const rawData = r5.data;
      const lineas: Array<{ id: string; username: string; password: string }> =
        Array.isArray(rawData)
          ? rawData
          : Array.isArray(rawData?.data)
            ? rawData.data
            : [];

      if (lineas.length === 0) {
        throw new Error(
          `api/line/list devolvió 0 líneas. Status: ${r5.status} raw: ${JSON.stringify(rawData).slice(0, 200)}`,
        );
      }
      const linea = lineas.find((l) => l.username === username);

      if (!linea) {
        // Fallback: última línea creada (primera del array podría ser la más reciente)
        console.warn(
          `⚠️  [CRM] No se encontró username=${username} exacto, usando primera línea`,
        );
        const primera = lineas[0];
        if (primera?.username) {
          return {
            ok: true,
            usuario: primera.username,
            contrasena: primera.password,
            mensaje: "Cuenta creada (fallback)",
            plan: planInfo.nombre,
            servidor: "http://mtv.bo:80 (en caso de usar IPTV SMARTERS PRO)",
          };
        }
        throw new Error("Línea creada pero no encontrada en la lista");
      }

      console.log(`✅ [CRM] Línea creada: ${linea.username}`);
      return {
        ok: true,
        usuario: linea.username,
        contrasena: linea.password,
        mensaje: "Cuenta creada exitosamente",
        plan: planInfo.nombre,
        servidor: "http://mtv.bo:80 (en caso de usar IPTV SMARTERS PRO)",
      };
    } catch (err) {
      console.error(`[CRM] Error intento ${intento}:`, err);
      if (intento === 1) {
        // Invalidar sesión y reintentar
        cachedSession = null;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const msg = err instanceof Error ? err.message : "Error desconocido";
      return { ok: false, mensaje: `Error con CRM: ${msg}` };
    }
  }

  return {
    ok: false,
    mensaje: "No se pudo crear la cuenta después de 2 intentos",
  };
}

/** Obtener el username determinístico de demo para un teléfono dado */
export function getDemoUsername(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  return `Dzk${digitos}`;
}

/**
 * Verifica si ya existe una cuenta demo para este número de teléfono.
 * La verificación se hace en tiempo real contra el CRM, por lo que si
 * el administrador borra la cuenta desde el panel, el número queda libre.
 */
export async function verificarDemoExistente(
  telefono: string,
): Promise<boolean> {
  const usernameDemo = getDemoUsername(telefono);
  console.log(
    `🔍 [CRM] Verificando si ya existe demo para ${telefono} (username: ${usernameDemo})`,
  );

  try {
    const sessionCookie = await getSession();
    const r = await axios.get(`${CRM_BASE_URL}/api/line/list`, {
      headers: {
        ...BASE_HEADERS,
        Cookie: sessionCookie,
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      validateStatus: () => true,
      timeout: 15_000,
    });

    const rawData = r.data;
    const lineas: Array<{ username: string }> = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData?.data)
        ? rawData.data
        : [];

    const existe = lineas.some((l) => l.username === usernameDemo);
    console.log(`   [CRM] ¿Demo existente para ${telefono}? ${existe}`);
    return existe;
  } catch (err) {
    console.error("[CRM] Error verificando demo existente:", err);
    return false;
  }
}

/** Busca una línea por username en la lista del CRM */
async function buscarLineaPorUsername(
  username: string,
  sessionCookie: string,
): Promise<{ id: string; username: string; password: string } | null> {
  const r = await axios.get(`${CRM_BASE_URL}/api/line/list`, {
    headers: {
      ...BASE_HEADERS,
      Cookie: sessionCookie,
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    validateStatus: () => true,
    timeout: 15_000,
  });
  const rawData = r.data;
  const lineas: Array<{ id: string; username: string; password: string }> =
    Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData?.data)
        ? rawData.data
        : [];
  return lineas.find((l) => l.username === username) ?? null;
}

/**
 * Renueva (extiende) una línea existente en el CRM.
 * Equivale a usar la opción "Renew / Extend" del panel.
 */
export async function renovarCuentaEnCRM(
  username: string,
  planComando: string,
): Promise<ResultadoCRM> {
  const planInfo = PLAN_ID_MAP[planComando.toUpperCase()];
  if (!planInfo) {
    return { ok: false, mensaje: `Plan no reconocido: ${planComando}` };
  }

  for (let intento = 1; intento <= 2; intento++) {
    try {
      console.log(
        `🔄 [CRM] Renovando cuenta username=${username} plan=${planComando} intento=${intento}`,
      );

      const sessionCookie = await getSession();

      // 1. Buscar la línea por username para obtener su ID interno
      const linea = await buscarLineaPorUsername(username, sessionCookie);
      if (!linea) {
        return {
          ok: false,
          mensaje: `No se encontró la cuenta *${username}* en el sistema. Verifica que el usuario sea correcto.`,
        };
      }

      // 2. GET /lines/{id}/renew-with-package → CSRF fresco
      const r1 = await axios.get(
        `${CRM_BASE_URL}/lines/${linea.id}/renew-with-package`,
        {
          headers: { ...BASE_HEADERS, Cookie: sessionCookie },
          maxRedirects: 2,
          validateStatus: () => true,
          timeout: 15_000,
        },
      );

      const csrf = csrfFromHtml(r1.data as string);
      if (!csrf || r1.status === 302) {
        console.warn("⚠️  [CRM] Sesión expirada al renovar, reconectando...");
        cachedSession = null;
        continue;
      }

      // 3. POST /lines/{id}/renew-with-package → extiende la línea
      const bodyParams = new URLSearchParams();
      bodyParams.append("_token", csrf);
      bodyParams.append("package", String(planInfo.id));

      const r2 = await axios.post(
        `${CRM_BASE_URL}/lines/${linea.id}/renew-with-package`,
        bodyParams.toString(),
        {
          headers: {
            ...BASE_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: CRM_BASE_URL,
            Referer: `${CRM_BASE_URL}/lines/${linea.id}/renew-with-package`,
            Cookie: sessionCookie,
          },
          maxRedirects: 0,
          validateStatus: () => true,
          timeout: 20_000,
        },
      );

      console.log(`   [CRM] renew-with-package → HTTP ${r2.status}`);

      if (r2.status !== 302 && r2.status !== 200) {
        throw new Error(`HTTP inesperado al renovar: ${r2.status}`);
      }

      console.log(`✅ [CRM] Cuenta renovada: ${username} → ${planInfo.nombre}`);
      return {
        ok: true,
        usuario: username,
        contrasena: linea.password,
        mensaje: "Cuenta renovada exitosamente",
        plan: planInfo.nombre,
        servidor: "http://mtv.bo:80 (en caso de usar IPTV SMARTERS PRO)",
      };
    } catch (err) {
      console.error(`[CRM] Error renovando intento ${intento}:`, err);
      if (intento === 1) {
        cachedSession = null;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const msg = err instanceof Error ? err.message : "Error desconocido";
      return { ok: false, mensaje: `Error al renovar: ${msg}` };
    }
  }

  return {
    ok: false,
    mensaje: "No se pudo renovar la cuenta después de 2 intentos",
  };
}

export interface EstadoCuenta {
  ok: boolean;
  usuario?: string;
  plan?: string;
  maxConexiones?: number;
  diasRestantes?: number;
  fechaExpiracion?: string;
  esPrueba?: boolean;
  mensaje: string;
}

/**
 * Consulta el estado de una cuenta en el CRM por nombre de usuario.
 * Retorna días restantes, fecha de vencimiento y plan activo.
 */
export async function consultarEstadoCuenta(username: string): Promise<EstadoCuenta> {
  console.log(`🔍 [CRM] Consultando estado de cuenta: ${username}`);
  try {
    const sessionCookie = await getSession();
    const r = await axios.get(`${CRM_BASE_URL}/api/line/list`, {
      headers: {
        ...BASE_HEADERS,
        Cookie: sessionCookie,
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      validateStatus: () => true,
      timeout: 15_000,
    });

    const rawData = r.data;
    const lineas: Array<{
      id: string;
      username: string;
      password: string;
      exp_date?: string | number | null;
      package_name?: string;
      max_connections?: number;
      is_trial?: number | boolean;
      enabled?: number | boolean;
    }> = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData?.data)
        ? rawData.data
        : [];

    const linea = lineas.find((l) => l.username === username);
    if (!linea) {
      return {
        ok: false,
        mensaje: `No se encontró ninguna cuenta con el usuario *${username}*.\n\nVerifica que lo hayas escrito correctamente.`,
      };
    }

    let diasRestantes: number | undefined;
    let fechaExpiracion: string | undefined;

    if (linea.exp_date != null) {
      // El CRM puede devolver el timestamp como número o string
      const raw = linea.exp_date;
      const ts = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      if (!isNaN(ts) && ts > 0) {
        // Algunos paneles usan segundos, otros milisegundos
        const expMs = ts < 1e12 ? ts * 1000 : ts;
        const expDate = new Date(expMs);
        const ahora = new Date();
        diasRestantes = Math.ceil((expDate.getTime() - ahora.getTime()) / 86_400_000);
        fechaExpiracion = expDate.toLocaleDateString("es-ES", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
      }
    }

    const esPrueba = linea.is_trial === 1 || linea.is_trial === true;

    console.log(`✅ [CRM] Estado de ${username}: plan=${linea.package_name ?? "?"} exp=${fechaExpiracion ?? "?"} días=${diasRestantes ?? "?"}`);

    return {
      ok: true,
      usuario: linea.username,
      plan: linea.package_name ?? undefined,
      maxConexiones: linea.max_connections ?? undefined,
      diasRestantes,
      fechaExpiracion,
      esPrueba,
      mensaje: "Cuenta encontrada",
    };
  } catch (err) {
    console.error("[CRM] Error consultando estado de cuenta:", err);
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, mensaje: `Error al consultar: ${msg}` };
  }
}

/** Verificar que el CRM es accesible */
export async function verificarConexionCRM(): Promise<boolean> {
  try {
    const r = await axios.get(`${CRM_BASE_URL}/login`, {
      timeout: 8_000,
      validateStatus: () => true,
    });
    return r.status === 200;
  } catch {
    return false;
  }
}
