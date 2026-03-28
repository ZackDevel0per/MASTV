/**
 * Gmail Service — Lee correos del banco para registrar pagos automáticamente.
 *
 * Flujo:
 * 1. Hace polling a Gmail cada INTERVALO_SEGUNDOS buscando correos nuevos
 *    del remitente configurado (GMAIL_REMITENTE_FILTRO).
 * 2. Extrae nombre y monto de cada correo nuevo.
 * 3. Llama a registrarPagoEnSheet() para guardarlo directamente en Google Sheets.
 * 4. Marca el correo como leído y guarda su ID para no procesarlo de nuevo.
 *
 * Autenticación: OAuth2 con cuenta personal de Gmail.
 * Variables de entorno requeridas:
 *   GMAIL_CLIENT_ID        — ID de cliente OAuth2
 *   GMAIL_CLIENT_SECRET    — Secreto de cliente OAuth2
 *   GMAIL_REFRESH_TOKEN    — Token de refresco (se obtiene una vez con /api/gmail/autorizar)
 *   GMAIL_REMITENTE_FILTRO — Email del banco / remitente a vigilar (ej: banco@bancounion.com.bo)
 *
 * Formato de correo para pruebas (envía desde tu otro Gmail):
 *   Asunto: cualquiera
 *   Cuerpo (texto plano o HTML):
 *     Nombre: JUAN PEREZ
 *     Monto: 29.00
 *
 *   También acepta variantes como:
 *     nombre: juan perez | monto: Bs 29
 *     Nombre: JUAN PEREZ - Monto: Bs. 29.00
 */

import { google, type gmail_v1 } from "googleapis";
import { registrarPagoEnSheet, obtenerIdsGmailProcesados } from "./sheets.js";

const INTERVALO_MS = 30_000; // 30 segundos entre cada revisión

let intervalId: ReturnType<typeof setInterval> | null = null;
let activo = false;

// Callback opcional que se llama cuando se detecta un pago nuevo
let callbackPagoDetectado: ((nombre: string, monto: number) => void) | null =
  null;

/** Registra un callback que se ejecuta cada vez que se detecta un pago via Gmail */
export function setCallbackPagoDetectado(
  fn: (nombre: string, monto: number) => void,
) {
  callbackPagoDetectado = fn;
}

let ultimaRevision: Date | null = null;
let totalProcesados = 0;
let errorActual: string | null = null;

const idsProcessados = new Set<string>();
const contadorReintentos = new Map<string, number>();
let ultimoTextoFallido: { id: string; asunto: string; texto: string } | null = null;

function crearCliente() {
  const clientId = process.env["GMAIL_CLIENT_ID"];
  const clientSecret = process.env["GMAIL_CLIENT_SECRET"];
  const refreshToken = process.env["GMAIL_REFRESH_TOKEN"];

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

/**
 * Extrae texto plano del payload de un correo Gmail.
 */
function extraerTexto(
  payload: gmail_v1.Schema$MessagePart | undefined,
): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64").toString("utf-8");
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")   // elimina bloques CSS
      .replace(/<script[\s\S]*?<\/script>/gi, " ") // elimina bloques JS
      .replace(/<[^>]+>/g, " ")                    // elimina etiquetas HTML
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const texto = extraerTexto(part);
      if (texto) return texto;
    }
  }

  return "";
}

interface DatosPago {
  nombre: string;
  monto: number;
}

/**
 * Intenta extraer nombre y monto del texto del correo.
 *
 * Soporta múltiples formatos:
 *
 * Formato 1 — Banco BCB / Multiplica Extranet (formato principal):
 *   Originante:  FABIAN YUCRA ADUVIRI
 *   Monto Recibido:  Bs 1.00
 *
 * Formato 2 — Correo de prueba (texto plano):
 *   Nombre: JUAN PEREZ
 *   Monto: 29.00
 *
 * Formato 3 — Notificación Yape:
 *   "QR DE NOMBRE te enviò Bs. 29.00"
 */
function parsearCorreo(texto: string): DatosPago | null {
  // ── Patrón 1: Formato banco BCB/Multiplica ─────────────────────────────
  // Extrae "Originante: NOMBRE" y "Monto Recibido: Bs MONTO"
  const matchOriginante = texto.match(
    /Originante\s*[:\s]+([A-ZÁÉÍÓÚÑ\s]{3,60}?)(?:\s{2,}|\n|$)/i,
  );
  const matchMontoRecibido = texto.match(
    /Monto\s+Recibido\s*[:\s]+Bs\s*([\d.,]+)/i,
  );

  if (matchOriginante && matchMontoRecibido) {
    const nombre = matchOriginante[1]!.trim().toUpperCase();
    const monto = parseFloat(matchMontoRecibido[1]!.replace(",", "."));
    if (nombre && !isNaN(monto) && monto > 0) {
      console.log(
        `🏦 [GMAIL] Formato banco detectado: ${nombre} → Bs ${monto}`,
      );
      return { nombre, monto };
    }
  }

  // ── Patrón 2: Nombre: XXX / Monto: YYY (correo de prueba) ────────────
  const matchNombre = texto.match(/nombre\s*:\s*([^\n|,]+)/i);
  const matchMonto = texto.match(/monto\s*:\s*(?:bs\.?\s*)?([\d.,]+)/i);

  if (matchNombre && matchMonto) {
    const nombre = matchNombre[1]!.trim().toUpperCase();
    const monto = parseFloat(matchMonto[1]!.replace(",", "."));
    if (nombre && !isNaN(monto) && monto > 0) {
      console.log(
        `📝 [GMAIL] Formato prueba detectado: ${nombre} → Bs ${monto}`,
      );
      return { nombre, monto };
    }
  }

  // ── Patrón 3: "QR DE NOMBRE te enviò Bs. MONTO" (notificación Yape) ───
  const matchYape = texto.match(
    /(?:QR\s+DE\s+)([A-ZÁÉÍÓÚÑ\s]+?)\s+te\s+envi[oò]/i,
  );
  const matchMontoYape = texto.match(/Bs\.?\s*([\d.,]+)/i);

  if (matchYape && matchMontoYape) {
    const nombre = matchYape[1]!.trim().toUpperCase();
    const monto = parseFloat(matchMontoYape[1]!.replace(",", "."));
    if (nombre && !isNaN(monto) && monto > 0) {
      console.log(`📱 [GMAIL] Formato Yape detectado: ${nombre} → Bs ${monto}`);
      return { nombre, monto };
    }
  }

  // ── Patrón 4: "Ordenante: NOMBRE" + "Monto: Bs X.XX" (BCP/otros bancos BO) ─
  const matchOrdenante = texto.match(
    /Ordenante\s*[:\s]+([A-ZÁÉÍÓÚÑ\s]{3,60}?)(?:\s{2,}|\n|Bs|$)/i,
  );
  const matchMontoBs = texto.match(/Monto\s*[:\s]+Bs\.?\s*([\d.,]+)/i);

  if (matchOrdenante && matchMontoBs) {
    const nombre = matchOrdenante[1]!.trim().toUpperCase();
    const monto = parseFloat(matchMontoBs[1]!.replace(",", "."));
    if (nombre && !isNaN(monto) && monto > 0) {
      console.log(`🏦 [GMAIL] Formato Ordenante/Monto detectado: ${nombre} → Bs ${monto}`);
      return { nombre, monto };
    }
  }

  // ── Patrón 5: "Remitente: NOMBRE" + monto en Bs ───────────────────────
  const matchRemitente = texto.match(
    /Remitente\s*[:\s]+([A-ZÁÉÍÓÚÑ\s]{3,60}?)(?:\s{2,}|\n|$)/i,
  );
  if (matchRemitente && matchMontoBs) {
    const nombre = matchRemitente[1]!.trim().toUpperCase();
    const monto = parseFloat(matchMontoBs[1]!.replace(",", "."));
    if (nombre && !isNaN(monto) && monto > 0) {
      console.log(`🏦 [GMAIL] Formato Remitente/Monto detectado: ${nombre} → Bs ${monto}`);
      return { nombre, monto };
    }
  }

  // ── Patrón 6: "Importe: Bs X.XX" con cualquier campo de nombre ─────────
  const matchImporte = texto.match(/Importe\s*[:\s]+Bs\.?\s*([\d.,]+)/i);
  const matchCualquierNombre = texto.match(
    /(?:Nombre|Cliente|Titular|Pagador|Depositante|De)\s*[:\s]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{2,50}?)(?:\s{2,}|\n|$)/i,
  );
  if (matchImporte && matchCualquierNombre) {
    const nombre = matchCualquierNombre[1]!.trim().toUpperCase();
    const monto = parseFloat(matchImporte[1]!.replace(",", "."));
    if (nombre && !isNaN(monto) && monto > 0) {
      console.log(`🏦 [GMAIL] Formato Importe detectado: ${nombre} → Bs ${monto}`);
      return { nombre, monto };
    }
  }

  // ── Patrón personalizado desde variable de entorno ─────────────────────
  const patronEnv = process.env["GMAIL_PATRON_REGEX"];
  if (patronEnv) {
    try {
      const regex = new RegExp(patronEnv, "i");
      const match = texto.match(regex);
      if (match && match[1] && match[2]) {
        const nombre = match[1].trim().toUpperCase();
        const monto = parseFloat(match[2].replace(",", "."));
        if (nombre && !isNaN(monto) && monto > 0) {
          return { nombre, monto };
        }
      }
    } catch {
      // Regex inválido, ignorar
    }
  }

  return null;
}

async function procesarCorreosNuevos() {
  const gmail = crearCliente();
  if (!gmail) {
    errorActual =
      "Credenciales de Gmail no configuradas (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)";
    return;
  }

  ultimaRevision = new Date();
  const remitente = process.env["GMAIL_REMITENTE_FILTRO"];

  try {
    // Construir query: no leídos (is:unread), de remitente si está configurado
    let query = "is:unread";
    if (remitente) {
      query += ` from:${remitente}`;
    }

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 20,
    });

    const messages = listRes.data.messages ?? [];

    if (messages.length === 0) {
      errorActual = null;
      return;
    }

    for (const msg of messages) {
      const id = msg.id!;
      if (idsProcessados.has(id)) continue;

      const detalle = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });

      const payload = detalle.data.payload;
      const asunto =
        payload?.headers?.find((h) => h.name === "Subject")?.value ??
        "(sin asunto)";
      const de =
        payload?.headers?.find((h) => h.name === "From")?.value ??
        "desconocido";
      const texto = extraerTexto(payload);

      console.log(`📧 [GMAIL] Correo nuevo de "${de}" — Asunto: "${asunto}"`);

      const datos = parsearCorreo(texto);

      if (datos) {
        console.log(
          `✅ [GMAIL] Pago detectado: ${datos.nombre} → Bs ${datos.monto}`,
        );
        await registrarPagoEnSheet(id, datos.nombre, datos.monto);
        totalProcesados++;
        if (callbackPagoDetectado) {
          try {
            callbackPagoDetectado(datos.nombre, datos.monto);
          } catch (cbErr) {
            console.error("[GMAIL] Error en callback de pago:", cbErr);
          }
        }
        // Marcar como leído solo si se procesó correctamente
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: { removeLabelIds: ["UNREAD"] },
        });
        idsProcessados.add(id);
      } else {
        // Contar reintentos — después de 5 fallas se descarta
        const reintentos = (contadorReintentos.get(id) ?? 0) + 1;
        contadorReintentos.set(id, reintentos);

        console.warn(
          `⚠️  [GMAIL] No se pudo extraer nombre/monto del correo ID ${id} (intento ${reintentos}/5)`,
        );
        console.warn(`📄 [GMAIL] Asunto: ${asunto}`);
        console.warn(`📄 [GMAIL] Texto (primeros 1500 chars):\n${texto.substring(0, 1500)}`);
        ultimoTextoFallido = { id, asunto, texto };

        if (reintentos >= 5) {
          console.warn(`🗑️  [GMAIL] Descartando correo ${id} después de 5 intentos`);
          await gmail.users.messages.modify({
            userId: "me",
            id,
            requestBody: { removeLabelIds: ["UNREAD"] },
          });
          idsProcessados.add(id);
          contadorReintentos.delete(id);
        }
        // Si no llegó a 5 reintentos: NO se marca como leído → se reintentará en el próximo ciclo
      }
    }

    errorActual = null;
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error("❌ [GMAIL] Error al revisar correos:", mensaje);
    errorActual = mensaje;
  }
}

export function iniciarGmailPolling() {
  if (activo) return;

  const clientId = process.env["GMAIL_CLIENT_ID"];
  const clientSecret = process.env["GMAIL_CLIENT_SECRET"];
  const refreshToken = process.env["GMAIL_REFRESH_TOKEN"];

  if (!clientId || !clientSecret || !refreshToken) {
    console.log(
      "ℹ️  [GMAIL] Credenciales no configuradas. Polling desactivado.",
    );
    console.log(
      "   → Para activar: configura GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET y GMAIL_REFRESH_TOKEN",
    );
    return;
  }

  activo = true;
  console.log("📬 [GMAIL] Iniciando polling de correos cada 30 segundos...");

  // Cargar IDs ya procesados desde el Sheet para evitar duplicados al reiniciar
  obtenerIdsGmailProcesados()
    .then((ids) => {
      for (const id of ids) idsProcessados.add(id);
    })
    .catch(console.error);

  // Primera revisión al arrancar
  procesarCorreosNuevos().catch(console.error);

  intervalId = setInterval(() => {
    procesarCorreosNuevos().catch(console.error);
  }, INTERVALO_MS);
}

export function detenerGmailPolling() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  activo = false;
  console.log("⏹️  [GMAIL] Polling detenido.");
}

/** Devuelve el último correo que no pudo ser parseado (para diagnóstico) */
export function getUltimoCorreoFallido() {
  return ultimoTextoFallido;
}

export function getGmailEstado() {
  const clientId = process.env["GMAIL_CLIENT_ID"];
  const clientSecret = process.env["GMAIL_CLIENT_SECRET"];
  const refreshToken = process.env["GMAIL_REFRESH_TOKEN"];
  const remitente = process.env["GMAIL_REMITENTE_FILTRO"];

  return {
    activo,
    configurado: !!(clientId && clientSecret && refreshToken),
    tieneRemitenteFiltro: !!remitente,
    remitenteFiltro: remitente ?? null,
    ultimaRevision: ultimaRevision?.toISOString() ?? null,
    totalProcesados,
    error: errorActual,
    intervaloSegundos: INTERVALO_MS / 1000,
  };
}

/**
 * Genera la URL de autorización OAuth2 que el usuario debe visitar una vez.
 */
export function generarUrlAutorizacion(redirectUri: string): string {
  const clientId = process.env["GMAIL_CLIENT_ID"];
  const clientSecret = process.env["GMAIL_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    throw new Error(
      "GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET deben estar configurados",
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.modify"],
  });
}

/**
 * Intercambia el código de autorización por un refresh_token.
 * Devuelve el refresh_token para que se guarde como secreto.
 */
export async function intercambiarCodigo(
  code: string,
  redirectUri: string,
): Promise<string> {
  const clientId = process.env["GMAIL_CLIENT_ID"];
  const clientSecret = process.env["GMAIL_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    throw new Error(
      "GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET deben estar configurados",
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await auth.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "No se obtuvo refresh_token. Asegúrate de usar prompt=consent en la URL de autorización.",
    );
  }

  return tokens.refresh_token;
}
