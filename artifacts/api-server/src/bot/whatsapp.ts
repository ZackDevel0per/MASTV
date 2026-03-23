import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
// @ts-ignore
import qrcode from "qrcode-terminal";
import pino from "pino";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const VIDEOS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/videos");

function leerVideoLocal(nombre: string): Buffer | null {
  try {
    const filePath = path.join(VIDEOS_DIR, nombre.endsWith(".mp4") ? nombre : `${nombre}.mp4`);
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

async function enviarVideo(jid: string, contenido: string, caption?: string) {
  const esUrl = contenido.startsWith("http");
  if (esUrl) {
    await sock!.sendMessage(jid, { video: { url: contenido }, caption });
  } else {
    const buffer = leerVideoLocal(contenido);
    if (buffer) {
      await sock!.sendMessage(jid, { video: buffer, caption });
    } else {
      console.error(`❌ Video local no encontrado: ${contenido}`);
      await sock!.sendMessage(jid, { text: `⚠️ Video no disponible temporalmente. Escribe *3* para soporte.` });
    }
  }
}
import {
  SALUDO_INICIAL,
  RESPUESTAS_NUMEROS,
  RESPUESTA_DESCONOCIDA,
  COMANDOS_ESPECIALES,
  ACTIVACION_EXITOSA,
  PALABRAS_SALUDO,
} from "./responses.js";
import { enviarImagen } from "./media-handler.js";
import { crearCuentaEnCRM, verificarDemoExistente, PLAN_ID_MAP } from "./crm-service.js";
import { registrarPedido } from "./payment-store.js";
import { buscarYUsarPago } from "./sheets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FOLDER = path.join(__dirname, "../../auth_info_baileys");
const logger = pino({ level: "silent" });

let sock: ReturnType<typeof makeWASocket> | null = null;
let estadoConexion:
  | "desconectado"
  | "esperando_qr"
  | "esperando_codigo"
  | "conectado" = "desconectado";
let botActivo = true;
let ultimoQR: string | null = null;
let codigoPareoPendiente: string | null = null;
let intentosReconexion = 0;

interface EstadoConversacion {
  ultimoComando: string;
  planSeleccionado?: string;
  hora: number;
  // Para el flujo de verificación de pago por Google Sheets
  esperandoVerificacion?: "nombre" | "monto";
  nombreVerificacion?: string;
}

const conversaciones: Record<string, EstadoConversacion> = {};

// Planes reconocidos para la creación automática de cuentas
const PLANES_VALIDOS = new Set(Object.keys(PLAN_ID_MAP));

export function getSock() {
  return sock;
}

export function getBotEstado() {
  return {
    conectado: estadoConexion === "conectado",
    estado: estadoConexion,
    botActivo,
    conversacionesActivas: Object.keys(conversaciones).length,
    tieneQR: ultimoQR !== null,
    codigoPareoPendiente,
  };
}

export function setBotActivo(valor: boolean) {
  botActivo = valor;
  console.log(`🤖 Bot: ${valor ? "ACTIVADO ✅" : "DESACTIVADO ⏸️"}`);
}

export async function enviarMensaje(telefono: string, mensaje: string) {
  if (!sock) throw new Error("Bot no conectado");
  const jid = telefono.includes("@s.whatsapp.net")
    ? telefono
    : `${telefono}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: mensaje });
}

export async function solicitarCodigoPareo(telefono: string): Promise<string> {
  if (!sock) throw new Error("El socket no está inicializado. Espera a que el bot arranque.");
  if (estadoConexion === "conectado") throw new Error("El bot ya está conectado.");

  const numeroLimpio = telefono.replace(/\D/g, "");
  if (!numeroLimpio || numeroLimpio.length < 10) {
    throw new Error("Número de teléfono inválido. Usa formato: 521XXXXXXXXXX");
  }

  const codigo = await sock.requestPairingCode(numeroLimpio);
  codigoPareoPendiente = codigo;
  estadoConexion = "esperando_codigo";

  console.log(`\n📱 CÓDIGO DE VINCULACIÓN: ${codigo}`);
  console.log("Ingresa este código en WhatsApp > Dispositivos vinculados > Vincular con número\n");

  return codigo;
}

export async function conectarBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    downloadHistory: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    shouldIgnoreJid: (jid) =>
      jid.endsWith("@g.us") || jid.endsWith("@broadcast"),
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log(`🔔 connection.update: connection=${connection ?? "undefined"} hasQR=${!!qr}`);

    if (qr) {
      ultimoQR = qr;
      estadoConexion = "esperando_qr";
      intentosReconexion = 0;
      console.log("\n========================================");
      console.log("📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP:");
      console.log("   WhatsApp → Dispositivos vinculados → Vincular dispositivo");
      console.log("========================================\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const err = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      const razon = err?.output?.statusCode;
      estadoConexion = "desconectado";
      ultimoQR = null;
      codigoPareoPendiente = null;
      console.log("🔴 Conexión cerrada. Razón:", razon);

      if (razon === DisconnectReason.loggedOut) {
        // Sesión inválida → borrar archivos y reconectar para pedir QR nuevo
        console.log("🔄 Sesión inválida. Borrando sesión para generar nuevo QR...");
        sock = null;
        try {
          const files = fs.readdirSync(AUTH_FOLDER);
          for (const file of files) {
            fs.unlinkSync(path.join(AUTH_FOLDER, file));
          }
        } catch { /* ignorar errores de limpieza */ }
        console.log("⏳ Reiniciando en 3s para mostrar QR...");
        intentosReconexion = 0;
        setTimeout(conectarBot, 3000);
      } else {
        intentosReconexion++;
        // Backoff progresivo: 5s, 10s, 20s, 30s (máx)
        const delay = Math.min(5000 * Math.pow(1.5, intentosReconexion - 1), 30000);
        console.log(`⏳ Reconectando en ${Math.round(delay / 1000)}s (intento ${intentosReconexion})...`);
        setTimeout(conectarBot, delay);
      }
    }

    if (connection === "open") {
      estadoConexion = "conectado";
      ultimoQR = null;
      codigoPareoPendiente = null;
      intentosReconexion = 0;
      console.log("✅ Bot de WhatsApp conectado correctamente!");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;

      const remitente = msg.key.remoteJid;
      if (!remitente || remitente.endsWith("@g.us") || remitente.endsWith("@broadcast")) continue;

      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

      if (!texto) continue;
      if (!botActivo) continue;

      console.log(`📩 Mensaje de ${remitente}: "${texto}"`);
      await manejarMensaje(remitente, texto.trim()).catch((err) => {
        console.error("❌ Error manejando mensaje de", remitente, ":", err);
      });
    }
  });
}

async function manejarMensaje(jid: string, texto: string) {
  const textoUpper = texto.toUpperCase().trim();

  // Actualizar estado de conversación
  const estadoAnterior = conversaciones[jid];
  conversaciones[jid] = {
    ultimoComando: textoUpper,
    planSeleccionado: estadoAnterior?.planSeleccionado,
    hora: Date.now(),
  };

  try {
    // ─── DEMO1 / DEMO3: Crear demo al instante ─────────────────────
    if (textoUpper === "DEMO1" || textoUpper === "DEMO3") {
      const planClave = textoUpper === "DEMO1" ? "DEMO_1H" : "DEMO_3H";
      const planInfo = PLAN_ID_MAP[planClave];
      const telefono = jid.replace("@s.whatsapp.net", "");

      // Verificar si ya existe una cuenta demo para este número
      const yaExisteDemo = await verificarDemoExistente(telefono);
      if (yaExisteDemo) {
        await sock!.sendMessage(jid, {
          text: `⚠️ *No es posible crear la cuenta*\n\nEste número ya generó una cuenta gratuita previamente.\n\nSi deseas disfrutar del servicio completo, escribe *1* para ver nuestros planes. 🚀`,
        });
        return;
      }

      await sock!.sendMessage(jid, {
        text: `⏳ *Creando tu cuenta de prueba...*\n\n🎁 ${planInfo.nombre}\n\n_Esto toma unos segundos, por favor espera..._`,
      });
      const resultado = await crearCuentaEnCRM(
        planClave,
        `Demo_${telefono}`,
        `${telefono}@zktv.bo`,
        telefono
      );

      if (resultado.ok && resultado.usuario) {
        const mensajeActivacion = ACTIVACION_EXITOSA({
          usuario: resultado.usuario,
          contrasena: resultado.contrasena ?? "",
          plan: `🎁 ${resultado.plan ?? planInfo.nombre} (DEMO GRATUITO)`,
          servidor: resultado.servidor,
        });
        await sock!.sendMessage(jid, { text: mensajeActivacion });
        await sock!.sendMessage(jid, {
          text: `💡 *¿Te gustó la prueba?*\n\nEscribe *1* para ver nuestros planes completos y contratar un servicio permanente. 🚀`,
        });
        conversaciones[jid] = {
          ultimoComando: "DEMO_CREADA",
          planSeleccionado: undefined,
          hora: Date.now(),
        };
      } else {
        await sock!.sendMessage(jid, {
          text: `⚠️ *No pudimos crear tu demo en este momento*\n\n${resultado.mensaje}\n\nEscribe *3* para contactar soporte.`,
        });
      }
      return;
    }

    // ─── CONFIRMAR: redirigir al flujo correcto ────────────────────
    if (textoUpper === "CONFIRMAR") {
      await sock!.sendMessage(jid, {
        text: `ℹ️ Para verificar tu pago, escribe *VERIFICAR*.\n\nSi aún no has realizado el pago, elige tu plan escribiendo *1* y sigue las instrucciones.`,
      });
      return;
    }

    // ─── Flujo de verificación paso 2: esperando NOMBRE ────────────
    if (estadoAnterior?.esperandoVerificacion === "nombre") {
      const nombreIngresado = texto.trim();
      conversaciones[jid] = {
        ultimoComando: "ESPERANDO_MONTO",
        planSeleccionado: estadoAnterior.planSeleccionado,
        hora: Date.now(),
        esperandoVerificacion: "monto",
        nombreVerificacion: nombreIngresado,
      };
      await sock!.sendMessage(jid, {
        text: `✍️ *Nombre registrado:* _${nombreIngresado}_\n\n💰 Ahora dime el *monto exacto* que pagaste.\n\nEscríbelo solo como número, por ejemplo: *29.00* o *29*`,
      });
      return;
    }

    // ─── Flujo de verificación paso 3: esperando MONTO ─────────────
    if (estadoAnterior?.esperandoVerificacion === "monto") {
      const montoIngresado = parseFloat(texto.trim().replace(",", "."));
      const nombre = estadoAnterior.nombreVerificacion ?? "";
      const planSeleccionado = estadoAnterior.planSeleccionado;
      const telefono = jid.replace("@s.whatsapp.net", "");

      if (isNaN(montoIngresado)) {
        await sock!.sendMessage(jid, {
          text: `⚠️ No entendí ese monto. Escríbelo solo como número, por ejemplo: *29.00* o *82*`,
        });
        return;
      }

      await sock!.sendMessage(jid, {
        text: `🔍 _Buscando tu pago en el sistema..._`,
      });

      try {
        const pagoEncontrado = await buscarYUsarPago(nombre, montoIngresado);

        if (!pagoEncontrado) {
          conversaciones[jid] = {
            ultimoComando: "VERIFICACION_FALLIDA",
            planSeleccionado,
            hora: Date.now(),
          };
          await sock!.sendMessage(jid, {
            text: `❌ *No encontramos tu pago*\n\nBuscamos:\n👤 Nombre: _${nombre}_\n💰 Monto: _Bs ${montoIngresado}_\n\nVerifica que:\n• El nombre sea *exactamente* como aparece en tu comprobante Yape\n• El monto sea exacto, sin redondeos\n\nEscribe *VERIFICAR* para intentarlo de nuevo o *3* para soporte.`,
          });
          return;
        }

        // Pago encontrado → crear cuenta
        if (!planSeleccionado || !PLAN_ID_MAP[planSeleccionado]) {
          await sock!.sendMessage(jid, {
            text: `✅ *Pago confirmado.*\n\nSin embargo, no tenemos registrado qué plan elegiste.\n\nPor favor escribe el código de tu plan (ej: *P1*, *Q2*, *R3*) o escribe *3* para que te ayudemos.`,
          });
          conversaciones[jid] = { ultimoComando: "PAGO_CONFIRMADO_SIN_PLAN", planSeleccionado: undefined, hora: Date.now() };
          return;
        }

        const planInfo = PLAN_ID_MAP[planSeleccionado];
        await sock!.sendMessage(jid, {
          text: `✅ *¡Pago confirmado!*\n\n📋 Plan: ${planInfo.nombre}\n💰 Monto: Bs ${montoIngresado}\n\n⏳ _Creando tu cuenta, espera unos segundos..._`,
        });

        const resultado = await crearCuentaEnCRM(
          planSeleccionado,
          `Cliente_${telefono}`,
          `${telefono}@zktv.bo`,
          telefono
        );

        if (resultado.ok && resultado.usuario) {
          const mensajeActivacion = ACTIVACION_EXITOSA({
            usuario: resultado.usuario,
            contrasena: resultado.contrasena ?? "",
            plan: resultado.plan ?? planInfo.nombre,
            servidor: resultado.servidor,
          });
          await sock!.sendMessage(jid, { text: mensajeActivacion });
          conversaciones[jid] = { ultimoComando: "CUENTA_CREADA", planSeleccionado: undefined, hora: Date.now() };
        } else {
          await sock!.sendMessage(jid, {
            text: `⚠️ *Pago confirmado pero hubo un problema al crear tu cuenta*\n\n${resultado.mensaje}\n\nEscribe *3* para que te ayudemos de inmediato.`,
          });
          conversaciones[jid] = { ultimoComando: "ERROR_CRM", planSeleccionado, hora: Date.now() };
        }
      } catch (err) {
        console.error("❌ Error verificando pago en Sheets:", err);
        await sock!.sendMessage(jid, {
          text: `⚠️ Hubo un error al consultar tu pago. Intenta de nuevo en un momento o escribe *3* para soporte.`,
        });
        conversaciones[jid] = { ultimoComando: "ERROR_SHEETS", planSeleccionado, hora: Date.now() };
      }
      return;
    }

    // ─── VERIFICAR: Iniciar flujo multi-paso ───────────────────────
    if (textoUpper === "VERIFICAR") {
      conversaciones[jid] = {
        ultimoComando: "ESPERANDO_NOMBRE",
        planSeleccionado: estadoAnterior?.planSeleccionado,
        hora: Date.now(),
        esperandoVerificacion: "nombre",
      };
      await sock!.sendMessage(jid, {
        text: `🔐 *Verificación de pago*\n\nPara confirmar tu pago necesito dos datos que aparecen en tu comprobante de Yape:\n\n*Paso 1 de 2:*\n👤 ¿Cuál es tu *nombre completo* exactamente como aparece en el comprobante?\n\n_Escríbelo tal cual, en mayúsculas o minúsculas._`,
      });
      return;
    }

    // ─── Comandos especiales (HOLA, MENU, AYUDA, ESTADO, ERRORES...) ──
    if (COMANDOS_ESPECIALES[textoUpper]) {
      const respuestas = COMANDOS_ESPECIALES[textoUpper];
      for (const resp of respuestas) {
        if (resp.tipo === "text") {
          await sock!.sendMessage(jid, { text: resp.contenido });
        } else if (resp.tipo === "video") {
          await enviarVideo(jid, resp.contenido, resp.caption);
        } else if (resp.tipo === "image") {
          await sock!.sendMessage(jid, { image: { url: resp.contenido }, caption: resp.caption });
        }
      }
      return;
    }

    // ─── Respuestas por número/letra ────────────────────────────────
    if (RESPUESTAS_NUMEROS[textoUpper]) {
      const respuestas = RESPUESTAS_NUMEROS[textoUpper];
      for (const resp of respuestas) {
        if (resp.tipo === "text") {
          await sock!.sendMessage(jid, { text: resp.contenido });
        } else if (resp.tipo === "video") {
          await enviarVideo(jid, resp.contenido, resp.caption);
        } else if (resp.tipo === "image") {
          await sock!.sendMessage(jid, { image: { url: resp.contenido }, caption: resp.caption });
        }
      }

      // Si es un plan pagado (P1-R4), guardar como plan seleccionado y registrar pedido
      const esPlanPagado = PLANES_VALIDOS.has(textoUpper) && !textoUpper.startsWith("DEMO");
      if (esPlanPagado) {
        conversaciones[jid] = {
          ultimoComando: textoUpper,
          planSeleccionado: textoUpper,
          hora: Date.now(),
        };
        const telefono = jid.replace("@s.whatsapp.net", "");
        const planInfo = PLAN_ID_MAP[textoUpper];
        if (planInfo) registrarPedido(telefono, textoUpper, planInfo.monto);
      }
      return;
    }

    // ─── Detectar saludos ───────────────────────────────────────────
    const esUnSaludo = PALABRAS_SALUDO.some((palabra) => textoUpper.includes(palabra));
    if (esUnSaludo) {
      await sock!.sendMessage(jid, { text: SALUDO_INICIAL });
      return;
    }

    // ─── Respuesta por defecto ──────────────────────────────────────
    await sock!.sendMessage(jid, { text: RESPUESTA_DESCONOCIDA });
  } catch (err) {
    console.error("❌ Error en manejarMensaje:", err);
    await sock!
      .sendMessage(jid, { text: "❌ Hubo un error. Por favor intenta de nuevo." })
      .catch((e) => console.error("Error enviando mensaje de error:", e));
  }
}

/**
 * Procesar pago manualmente (desde Tasker/API)
 */
export interface ProcesarPagoInput {
  nombreCliente: string;
  telefono?: string;
  usuario: string;
  contrasena: string;
  plan?: string;
  monto?: string;
  fecha?: string;
}

export async function procesarPago(input: ProcesarPagoInput) {
  const { nombreCliente, telefono, usuario, contrasena, plan } = input;

  if (!telefono) {
    return { ok: false, mensaje: "Se requiere el número de teléfono del cliente" };
  }

  try {
    const mensajeActivacion = ACTIVACION_EXITOSA({
      usuario,
      contrasena,
      plan: plan || "Plan Activo",
    });

    await enviarMensaje(telefono, mensajeActivacion);

    conversaciones[`${telefono}@s.whatsapp.net`] = {
      ultimoComando: "PAGADO",
      hora: Date.now(),
    };

    console.log(`✅ Pago procesado para ${nombreCliente} (${telefono}).`);
    return {
      ok: true,
      mensaje: `Cuenta activada y credenciales enviadas a ${telefono}`,
      telefono,
      usuario,
    };
  } catch (err) {
    console.error("Error procesando pago:", err);
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al procesar pago",
    };
  }
}

/**
 * Enviar imagen personalizada a un cliente
 */
export async function enviarImagenPersonalizada(
  telefono: string,
  urlImagen: string,
  pie?: string
) {
  try {
    await enviarImagen(telefono, urlImagen, pie);
    console.log(`📸 Imagen enviada a ${telefono}`);
    return { ok: true, mensaje: "Imagen enviada correctamente" };
  } catch (err) {
    console.error("Error enviando imagen:", err);
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al enviar imagen",
    };
  }
}

/**
 * Enviar video personalizado a un cliente
 */
export async function enviarVideoPersonalizado(
  telefono: string,
  urlVideo: string,
  pie?: string
) {
  try {
    const jid = telefono.includes("@s.whatsapp.net") ? telefono : `${telefono}@s.whatsapp.net`;
    await enviarVideo(jid, urlVideo, pie);
    console.log(`🎥 Video enviado a ${telefono}`);
    return { ok: true, mensaje: "Video enviado correctamente" };
  } catch (err) {
    console.error("Error enviando video:", err);
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al enviar video",
    };
  }
}
