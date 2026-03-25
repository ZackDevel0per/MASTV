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

/** Extrae el atributo action del primer <form> que contenga _token en el HTML */
function formActionFromHtml(html: string, baseUrl: string): string {
  const match = html.match(/<form[^>]+action="([^"]+)"/i);
  if (!match) return "";
  const action = match[1]!;
  // Si es relativa, hacerla absoluta
  if (action.startsWith("http")) return action;
  return `${baseUrl}${action.startsWith("/") ? "" : "/"}${action}`;
}

/** Extrae el _method oculto del formulario (PUT, PATCH, etc.) si existe */
function formMethodFromHtml(html: string): string {
  return html.match(/name="_method"\s+value="([^"]+)"/i)?.[1]?.toUpperCase() ?? "";
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
 * Solo para debug: obtiene el HTML + JS externos de la página renew-with-package
 * de una cuenta, sin hacer ningún cambio real.
 */
export async function debugRenewPage(username: string): Promise<object> {
  const sessionCookie = await getSession();
  const linea = await buscarLineaPorUsername(username, sessionCookie);
  if (!linea) return { error: `Línea no encontrada: ${username}` };

  const url = `${CRM_BASE_URL}/lines/${linea.id}/renew-with-package`;
  const r = await axios.get(url, {
    headers: { ...BASE_HEADERS, Cookie: sessionCookie },
    maxRedirects: 3, validateStatus: () => true, timeout: 15_000,
  });
  const html = r.data as string;

  const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/gi)].map(m => m[0].substring(0, 3000));
  const selects = [...html.matchAll(/<select[\s\S]*?<\/select>/gi)].map(m => m[0].substring(0, 1000));
  const extScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);

  // Fetch relevant external JS files looking for "renew" logic
  const jsResults: Record<string, string> = {};
  for (const src of extScripts) {
    const fullSrc = src.startsWith("http") ? src : `${CRM_BASE_URL}${src}`;
    try {
      const jr = await axios.get(fullSrc, { timeout: 10_000, validateStatus: () => true });
      const js = jr.data as string;
      if (/renew|bouquet|package/i.test(js)) {
        // Extract the relevant sections (100 lines around "renew")
        const lines = js.split("\n");
        const relevant = lines.filter(l => /renew|bouquet.*package|package.*renew|ajax.*renew/i.test(l));
        if (relevant.length > 0) jsResults[src] = relevant.slice(0, 30).join("\n");
      }
    } catch { /* skip */ }
  }

  return { lineId: linea.id, status: r.status, forms, selects, extScripts, jsResults };
}

/**
 * Renueva (extiende) una línea existente en el CRM cambiando el paquete.
 * Estrategia: usar la action real del formulario + intentar múltiples endpoints.
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
        `🔄 [CRM] Renovando cuenta username=${username} plan=${planComando} (id=${planInfo.id}) intento=${intento}`,
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

      // 2. GET /lines/{id}/renew-with-package → obtener CSRF + form action real
      const renewWithPackagePage = `${CRM_BASE_URL}/lines/${linea.id}/renew-with-package`;
      const r1 = await axios.get(renewWithPackagePage, {
        headers: { ...BASE_HEADERS, Cookie: sessionCookie },
        maxRedirects: 3,
        validateStatus: () => true,
        timeout: 15_000,
      });

      const csrf = csrfFromHtml(r1.data as string);
      if (!csrf || r1.status === 302) {
        console.warn("⚠️  [CRM] Sesión expirada al renovar, reconectando...");
        cachedSession = null;
        continue;
      }

      const html = r1.data as string;
      const updatedCookie = cookieFromHeaders(r1.headers as Record<string, unknown>);
      const activeCookie = updatedCookie || sessionCookie;

      // Extraer form action real y _method oculto del formulario
      const formAction = formActionFromHtml(html, CRM_BASE_URL);
      const formMethod = formMethodFromHtml(html);
      console.log(`   [CRM] Form action="${formAction}" _method="${formMethod}"`);

      const commonHeaders = {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-TOKEN": csrf,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*",
        Origin: CRM_BASE_URL,
        Referer: renewWithPackagePage,
        Cookie: activeCookie,
      };

      // ── INTENTO A: Si el formulario tiene action real, usarla directamente ──
      let r2: Awaited<ReturnType<typeof axios.post>> | null = null;

      if (formAction && !formAction.endsWith("/renew-with-package")) {
        // El form apunta a un endpoint diferente — usarlo
        const bodyA = new URLSearchParams();
        bodyA.append("_token", csrf);
        if (formMethod) bodyA.append("_method", formMethod);
        bodyA.append("package", String(planInfo.id));
        for (const bid of TODOS_LOS_BOUQUETS) bodyA.append("bouquet_ids[]", bid);

        r2 = await axios.post(formAction, bodyA.toString(), {
          headers: commonHeaders, maxRedirects: 0, validateStatus: () => true, timeout: 20_000,
        });
        console.log(`   [CRM] A) POST ${formAction} → HTTP ${r2.status}`);
        if (r2.status !== 200 && r2.status !== 302) r2 = null; // fallback
      }

      // ── INTENTO B: POST /lines/{id}/renew con package + TODOS los bouquets ──
      // Esto replica exactamente el flow de creación (store-with-package) que sí funciona.
      if (!r2) {
        const renewUrl = `${CRM_BASE_URL}/lines/${linea.id}/renew`;
        const bodyB = new URLSearchParams();
        bodyB.append("_token", csrf);
        bodyB.append("package", String(planInfo.id));
        for (const bid of TODOS_LOS_BOUQUETS) bodyB.append("bouquet_ids[]", bid);

        r2 = await axios.post(renewUrl, bodyB.toString(), {
          headers: commonHeaders, maxRedirects: 0, validateStatus: () => true, timeout: 20_000,
        });
        console.log(`   [CRM] B) POST /lines/${linea.id}/renew + bouquets → HTTP ${r2.status}`);
      }

      // ── INTENTO C: PATCH /lines/{id} para cambiar package, luego /renew ──
      // Si B tampoco funciona, intentar cambiar el package por separado primero.
      if (r2.status !== 200 && r2.status !== 302) {
        console.log(`   [CRM] C) Intentando PATCH /lines/${linea.id} para cambiar package...`);

        // GET /lines/{id}/edit para obtener CSRF fresco del form de edición
        const editPage = `${CRM_BASE_URL}/lines/${linea.id}/edit`;
        const rEdit = await axios.get(editPage, {
          headers: { ...BASE_HEADERS, Cookie: activeCookie },
          maxRedirects: 3, validateStatus: () => true, timeout: 15_000,
        });
        const csrfEdit = csrfFromHtml(rEdit.data as string) || csrf;
        const cookieEdit = cookieFromHeaders(rEdit.headers as Record<string, unknown>) || activeCookie;

        const bodyPatch = new URLSearchParams();
        bodyPatch.append("_token", csrfEdit);
        bodyPatch.append("_method", "PATCH");
        bodyPatch.append("package", String(planInfo.id));
        for (const bid of TODOS_LOS_BOUQUETS) bodyPatch.append("bouquet_ids[]", bid);

        const rPatch = await axios.post(`${CRM_BASE_URL}/lines/${linea.id}`, bodyPatch.toString(), {
          headers: { ...commonHeaders, Cookie: cookieEdit, "X-CSRF-TOKEN": csrfEdit, Referer: editPage },
          maxRedirects: 0, validateStatus: () => true, timeout: 20_000,
        });
        console.log(`   [CRM] C1) PATCH /lines/${linea.id} → HTTP ${rPatch.status}`);

        // Ahora renovar con el package ya cambiado
        const bodyRenew = new URLSearchParams();
        bodyRenew.append("_token", csrfEdit);
        bodyRenew.append("package", String(planInfo.id));
        r2 = await axios.post(`${CRM_BASE_URL}/lines/${linea.id}/renew`, bodyRenew.toString(), {
          headers: { ...commonHeaders, Cookie: cookieEdit, "X-CSRF-TOKEN": csrfEdit },
          maxRedirects: 0, validateStatus: () => true, timeout: 20_000,
        });
        console.log(`   [CRM] C2) POST /lines/${linea.id}/renew (post-patch) → HTTP ${r2.status}`);
      }

      if (!r2 || (r2.status !== 302 && r2.status !== 200)) {
        const bodySnippet = r2
          ? (typeof r2.data === "string" ? r2.data.substring(0, 200) : JSON.stringify(r2.data).substring(0, 200))
          : "sin respuesta";
        throw new Error(`HTTP inesperado al renovar: ${r2?.status} — ${bodySnippet}`);
      }

      // Verificar que el CRM efectivamente aplicó el plan correcto
      await new Promise(r => setTimeout(r, 1500));
      const lineaActualizada = await buscarLineaPorUsername(username, activeCookie);
      const planAplicado = lineaActualizada?.exp_date ?? "desconocida";
      console.log(`✅ [CRM] Cuenta renovada: ${username} → plan solicitado=${planInfo.nombre} exp_date=${planAplicado}`);
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
 * Limpia el nombre del plan eliminando precio y créditos, y expande abreviaturas.
 * Entrada:  "1 MES - 1 DISP (29 Bs) - Costo: 0.5 creditos."
 * Salida:   "1 MES - 1 DISPOSITIVO"
 */
function limpiarNombrePlan(nombre: string): string {
  // Quitar todo lo que venga después de " (" (precio) o "- Costo" (créditos)
  let limpio = nombre
    .replace(/\s*\(.*?\)/g, "")           // quita (29 Bs) y similares
    .replace(/\s*-\s*Costo:[^]*/i, "")    // quita - Costo: 0.5 creditos. y resto
    .trim();

  // Expandir "1 DISP" → "1 DISPOSITIVO", "2 DISP" → "2 DISPOSITIVOS"
  limpio = limpio.replace(/(\d+)\s+DISP\b/gi, (_, n) =>
    `${n} DISPOSITIVO${parseInt(n, 10) !== 1 ? "S" : ""}`
  );

  return limpio;
}

/**
 * Intenta parsear una fecha de vencimiento desde varios formatos posibles
 * que pueden devolver los paneles IPTV:
 *   - Unix timestamp en segundos (número)
 *   - Unix timestamp en milisegundos (número grande)
 *   - String "YYYY-MM-DD HH:MM:SS"
 *   - String "YYYY-MM-DD"
 * Devuelve null si el valor es 0, nulo o no parseable.
 */
function parsearFechaExpiracion(
  raw: string | number | null | undefined,
): Date | null {
  if (raw == null || raw === "" || raw === 0 || raw === "0") return null;

  if (typeof raw === "number") {
    if (raw === 0) return null;
    // Heurístico: si es menor a 1e10, es segundos; si no, milisegundos
    const ms = raw < 1e10 ? raw * 1000 : raw;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  // String: puede ser "YYYY-MM-DD HH:MM:SS" o "YYYY-MM-DD"
  const str = String(raw).trim();
  if (str === "0" || str === "") return null;

  const d = new Date(str.replace(" ", "T")); // ISO-compatible
  return isNaN(d.getTime()) ? null : d;
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
    const lineas: Array<Record<string, unknown>> = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData?.data)
        ? rawData.data
        : [];

    const linea = lineas.find((l) => l["username"] === username);
    if (!linea) {
      return {
        ok: false,
        mensaje: `No se encontró ninguna cuenta con el usuario *${username}*.\n\nVerifica que lo hayas escrito correctamente.`,
      };
    }

    // Log de campos disponibles para debug (solo las claves)
    console.log(`   [CRM] Campos disponibles: ${Object.keys(linea).join(", ")}`);

    // Intentar varios campos conocidos de fecha de vencimiento
    const rawFecha =
      linea["exp_date"] ??
      linea["expiry_date"] ??
      linea["date_end"] ??
      linea["endDate"] ??
      null;

    const expDate = parsearFechaExpiracion(rawFecha as string | number | null);

    let diasRestantes: number | undefined;
    let fechaExpiracion: string | undefined;

    if (expDate) {
      const ahora = new Date();
      diasRestantes = Math.ceil((expDate.getTime() - ahora.getTime()) / 86_400_000);
      fechaExpiracion = expDate.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }

    const esPrueba =
      linea["is_trial"] === 1 ||
      linea["is_trial"] === true ||
      linea["is_trial"] === "1";

    const planRaw = (linea["package_name"] as string | undefined) ?? undefined;
    const plan = planRaw ? limpiarNombrePlan(planRaw) : undefined;

    const maxConexiones =
      linea["max_connections"] != null
        ? Number(linea["max_connections"])
        : undefined;

    console.log(
      `✅ [CRM] Estado de ${username}: plan="${plan ?? "?"}" exp=${fechaExpiracion ?? "sin fecha"} días=${diasRestantes ?? "?"}`,
    );

    return {
      ok: true,
      usuario: linea["username"] as string,
      plan,
      maxConexiones,
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
