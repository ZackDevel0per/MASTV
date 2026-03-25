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
      await enviarConDelay(jid, `⚠️ Video no disponible temporalmente. Escribe *3* para soporte.`);
    }
  }
}

/**
 * Simula escritura humana antes de enviar un mensaje de texto.
 * 1. Pequeña pausa de "reacción" (300-1200ms)
 * 2. Muestra el indicador "escribiendo..." en WhatsApp
 * 3. Espera un tiempo proporcional a la longitud del texto (entre 2s y 5s, con ruido aleatorio)
 * 4. Detiene el indicador y envía el mensaje
 *
 * Esto reduce significativamente el riesgo de ban por comportamiento automatizado.
 */
async function enviarConDelay(jid: string, texto: string): Promise<void> {
  // Pausa de "reacción" antes de empezar a escribir
  await new Promise(r => setTimeout(r, 300 + Math.random() * 900));

  // Mostrar indicador "escribiendo..."
  await sock!.sendPresenceUpdate("composing", jid).catch(() => {});

  // Duración del typing: ~30ms por carácter, mínimo 2s, máximo 5s, con ±300ms de ruido
  const base = Math.min(Math.max(texto.length * 30, 2000), 5000);
  const duracion = base + (Math.random() * 600 - 300);
  await new Promise(r => setTimeout(r, duracion));

  // Detener indicador y enviar
  await sock!.sendPresenceUpdate("paused", jid).catch(() => {});
  await sock!.sendMessage(jid, { text: texto });
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
import { crearCuentaEnCRM, renovarCuentaEnCRM, verificarDemoExistente, PLAN_ID_MAP } from "./crm-service.js";
import { registrarPedido } from "./payment-store.js";
import { buscarYUsarPagoLocal } from "./yape-store.js";

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

// Chats donde el dueño ha silenciado el bot con /stop
const chatsSilenciados = new Set<string>();

// Comandos que el dueño puede enviar desde su propio WhatsApp
const COMANDOS_DUENO: Record<string, (jid: string) => Promise<string>> = {
  "/stop": async (jid) => {
    chatsSilenciados.add(jid);
    console.log(`🔇 [DUEÑO] Bot silenciado en ${jid}`);
    return "🔇 Bot silenciado en este chat. Escribe */start* para reactivarlo.";
  },
  "/start": async (jid) => {
    chatsSilenciados.delete(jid);
    console.log(`🔊 [DUEÑO] Bot reactivado en ${jid}`);
    return "🔊 Bot reactivado en este chat.";
  },
  "/status": async (jid) => {
    const silenciado = chatsSilenciados.has(jid);
    const totalSilenciados = chatsSilenciados.size;
    return `📊 *Estado del bot*\n\n• Global: ${botActivo ? "✅ Activo" : "⏸️ Pausado"}\n• Este chat: ${silenciado ? "🔇 Silenciado" : "🔊 Activo"}\n• Chats silenciados: ${totalSilenciados}`;
  },
  "/silenciados": async (_jid) => {
    if (chatsSilenciados.size === 0) return "📋 No hay chats silenciados.";
    const lista = [...chatsSilenciados]
      .map((j, i) => `${i + 1}. ${j.replace("@s.whatsapp.net", "").replace("@g.us", "")}`)
      .join("\n");
    return `📋 *Chats silenciados (${chatsSilenciados.size}):*\n\n${lista}`;
  },
  "/limpiar": async (_jid) => {
    const total = chatsSilenciados.size;
    chatsSilenciados.clear();
    console.log(`🧹 [DUEÑO] Todos los chats desilenciados (${total})`);
    if (total === 0) return "📋 No había chats silenciados.";
    return `✅ Se reactivaron *${total}* chat${total === 1 ? "" : "s"}. El bot responde en todos de nuevo.`;
  },
};

interface EstadoConversacion {
  ultimoComando: string;
  planSeleccionado?: string;
  hora: number;
  esperandoVerificacion?: "nombre" | "monto";
  nombreVerificacion?: string;
  flujo?: "nuevo" | "renovar";
  usuarioRenovar?: string;
  esperandoUsuarioRenovar?: boolean;
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
    chatsSilenciados: chatsSilenciados.size,
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

      // ── Comandos del dueño (mensajes enviados desde el propio número vinculado) ──
      if (msg.key.fromMe) {
        const comando = texto.trim().toLowerCase();
        const accion = COMANDOS_DUENO[comando];
        if (accion) {
          console.log(`👑 [DUEÑO] Comando recibido: "${comando}" en ${remitente}`);
          const respuesta = await accion(remitente).catch((err) => {
            console.error("❌ Error ejecutando comando de dueño:", err);
            return "❌ Error ejecutando el comando.";
          });
          await sock!.sendMessage(remitente, { text: respuesta }).catch(() => {});
        }
        continue;
      }

      if (!botActivo) continue;

      // ── Verificar si el chat está silenciado ──────────────────────────
      if (chatsSilenciados.has(remitente)) {
        console.log(`🔇 [SILENCIADO] Ignorando mensaje de ${remitente}`);
        continue;
      }

      console.log(`📩 Mensaje de ${remitente}: "${texto}"`);
      await manejarMensaje(remitente, texto.trim()).catch((err) => {
        console.error("❌ Error manejando mensaje de", remitente, ":", err);
      });
    }
  });
}

async function manejarMensaje(jid: string, texto: string) {
  const textoUpper = texto.toUpperCase().trim();

  // Actualizar estado de conversación (preservar campos del flujo activo)
  const estadoAnterior = conversaciones[jid];
  conversaciones[jid] = {
    ultimoComando: textoUpper,
    planSeleccionado: estadoAnterior?.planSeleccionado,
    flujo: estadoAnterior?.flujo,
    usuarioRenovar: estadoAnterior?.usuarioRenovar,
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
        await enviarConDelay(jid, `⚠️ *No es posible crear la cuenta*\n\nEste número ya generó una cuenta gratuita previamente.\n\nSi deseas disfrutar del servicio completo, escribe *1* para ver nuestros planes. 🚀`);
        return;
      }

      await enviarConDelay(jid, `⏳ *Creando tu cuenta de prueba...*\n\n🎁 ${planInfo.nombre}\n\n_Esto toma unos segundos, por favor espera..._`);
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
        await enviarConDelay(jid, mensajeActivacion);
        await enviarConDelay(jid, `💡 *¿Te gustó la prueba?*\n\nEscribe *1* para ver nuestros planes completos y contratar un servicio permanente. 🚀`);
        conversaciones[jid] = {
          ultimoComando: "DEMO_CREADA",
          planSeleccionado: undefined,
          hora: Date.now(),
        };
      } else {
        await enviarConDelay(jid, `⚠️ *No pudimos crear tu demo en este momento*\n\n${resultado.mensaje}\n\nEscribe *3* para contactar soporte.`);
      }
      return;
    }

    // ─── CONFIRMAR: redirigir al flujo correcto ────────────────────
    if (textoUpper === "CONFIRMAR") {
      await enviarConDelay(jid, `ℹ️ Para verificar tu pago, escribe *VERIFICAR*.\n\nSi aún no has realizado el pago, elige tu plan escribiendo *1* y sigue las instrucciones.`);
      return;
    }

    // ─── Flujo de verificación paso 2: esperando NOMBRE ────────────
    if (estadoAnterior?.esperandoVerificacion === "nombre") {
      const nombreIngresado = texto.trim();
      conversaciones[jid] = {
        ultimoComando: "ESPERANDO_MONTO",
        planSeleccionado: estadoAnterior.planSeleccionado,
        flujo: estadoAnterior.flujo,
        usuarioRenovar: estadoAnterior.usuarioRenovar,
        hora: Date.now(),
        esperandoVerificacion: "monto",
        nombreVerificacion: nombreIngresado,
      };
      await enviarConDelay(jid, `✍️ *Nombre registrado:* _${nombreIngresado}_\n\n💰 Ahora dime el *monto exacto* que pagaste.\n\nEscríbelo solo como número, por ejemplo: *29.00* o *29*`);
      return;
    }

    // ─── Flujo de verificación paso 3: esperando MONTO ─────────────
    if (estadoAnterior?.esperandoVerificacion === "monto") {
      const montoIngresado = parseFloat(texto.trim().replace(",", "."));
      const nombre = estadoAnterior.nombreVerificacion ?? "";
      const planSeleccionado = estadoAnterior.planSeleccionado;
      const telefono = jid.replace("@s.whatsapp.net", "");

      if (isNaN(montoIngresado)) {
        await enviarConDelay(jid, `⚠️ No entendí ese monto. Escríbelo solo como número, por ejemplo: *29.00* o *82*`);
        return;
      }

      const flujo = estadoAnterior.flujo ?? "nuevo";
      const usuarioRenovar = estadoAnterior.usuarioRenovar;

      // ── Validar que el monto coincida exactamente con el plan ──────
      if (planSeleccionado && PLAN_ID_MAP[planSeleccionado]) {
        const planInfo = PLAN_ID_MAP[planSeleccionado];
        if (montoIngresado !== planInfo.monto) {
          conversaciones[jid] = {
            ultimoComando: "MONTO_INCORRECTO",
            planSeleccionado,
            flujo,
            usuarioRenovar,
            hora: Date.now(),
            esperandoVerificacion: "monto",
            nombreVerificacion: nombre,
          };
          await enviarConDelay(jid, `❌ *El monto no corresponde al plan seleccionado*\n\n📋 Plan elegido: ${planInfo.nombre}\n💰 Monto esperado: *Bs ${planInfo.monto}*\n💸 Monto que indicaste: Bs ${montoIngresado}\n\nEl pago debe ser exactamente *Bs ${planInfo.monto}*.\n\n¿Cometiste un error al escribir? Ingresa de nuevo el monto exacto que aparece en tu comprobante:`);
          return;
        }
      }

      await enviarConDelay(jid, `🔍 _Buscando tu pago en el sistema..._`);

      try {
        const pagoEncontrado = buscarYUsarPagoLocal(nombre, montoIngresado);

        if (!pagoEncontrado) {
          conversaciones[jid] = {
            ultimoComando: "VERIFICACION_FALLIDA",
            planSeleccionado,
            flujo,
            usuarioRenovar,
            hora: Date.now(),
          };
          await enviarConDelay(jid, `❌ *No encontramos tu pago*\n\nBuscamos:\n👤 Nombre: _${nombre}_\n💰 Monto: _Bs ${montoIngresado}_\n\nVerifica que:\n• El nombre sea *exactamente* como aparece en tu comprobante Yape\n• El monto sea exacto, sin redondeos\n\nEscribe *VERIFICAR* para intentarlo de nuevo o *3* para soporte.`);
          return;
        }

        if (!planSeleccionado || !PLAN_ID_MAP[planSeleccionado]) {
          await enviarConDelay(jid, `✅ *Pago confirmado.*\n\nSin embargo, no tenemos registrado qué plan elegiste.\n\nPor favor escribe el código de tu plan (ej: *P1*, *Q2*, *R3*) o escribe *3* para que te ayudemos.`);
          conversaciones[jid] = { ultimoComando: "PAGO_CONFIRMADO_SIN_PLAN", planSeleccionado: undefined, hora: Date.now() };
          return;
        }

        const planInfo = PLAN_ID_MAP[planSeleccionado];

        if (flujo === "renovar" && usuarioRenovar) {
          // ── Renovar cuenta existente ──────────────────────────────
          await enviarConDelay(jid, `✅ *¡Pago confirmado!*\n\n📋 Plan: ${planInfo.nombre}\n💰 Monto: Bs ${montoIngresado}\n👤 Usuario: ${usuarioRenovar}\n\n⏳ _Renovando tu cuenta, espera unos segundos..._`);

          const resultado = await renovarCuentaEnCRM(usuarioRenovar, planSeleccionado);

          if (resultado.ok) {
            await enviarConDelay(jid, `🎉 *¡Cuenta renovada exitosamente!*\n\n🔐 *Credenciales de acceso:*\n📛 Nombre: \`mastv\`\n👤 Usuario: \`${resultado.usuario}\`\n🔑 Contraseña: \`${resultado.contrasena}\`\n🌐 URL: \`${resultado.servidor || "http://mtv.bo:80"}\`\n\n📺 *Plan renovado:* ${resultado.plan}\n\n✅ Tu servicio ha sido extendido. ¡Disfruta ZKTV! 🚀`);
            conversaciones[jid] = { ultimoComando: "CUENTA_RENOVADA", planSeleccionado: undefined, hora: Date.now() };
          } else {
            await enviarConDelay(jid, `⚠️ *Pago confirmado pero hubo un problema al renovar tu cuenta*\n\n${resultado.mensaje}\n\nEscribe *3* para que te ayudemos de inmediato.`);
            conversaciones[jid] = { ultimoComando: "ERROR_CRM_RENOVAR", planSeleccionado, hora: Date.now() };
          }
        } else {
          // ── Crear cuenta nueva ────────────────────────────────────
          await enviarConDelay(jid, `✅ *¡Pago confirmado!*\n\n📋 Plan: ${planInfo.nombre}\n💰 Monto: Bs ${montoIngresado}\n\n⏳ _Creando tu cuenta, espera unos segundos..._`);

          const resultado = await crearCuentaEnCRM(
            planSeleccionado,
            `Cliente_${telefono}`,
            `${telefono}@zktv.bo`,
            telefono,
          );

          if (resultado.ok && resultado.usuario) {
            const mensajeActivacion = ACTIVACION_EXITOSA({
              usuario: resultado.usuario,
              contrasena: resultado.contrasena ?? "",
              plan: resultado.plan ?? planInfo.nombre,
              servidor: resultado.servidor,
            });
            await enviarConDelay(jid, mensajeActivacion);
            conversaciones[jid] = { ultimoComando: "CUENTA_CREADA", planSeleccionado: undefined, hora: Date.now() };
          } else {
            await enviarConDelay(jid, `⚠️ *Pago confirmado pero hubo un problema al crear tu cuenta*\n\n${resultado.mensaje}\n\nEscribe *3* para que te ayudemos de inmediato.`);
            conversaciones[jid] = { ultimoComando: "ERROR_CRM", planSeleccionado, hora: Date.now() };
          }
        }
      } catch (err) {
        console.error("❌ Error en verificación de pago:", err);
        await enviarConDelay(jid, `⚠️ Hubo un error al consultar tu pago. Intenta de nuevo en un momento o escribe *3* para soporte.`);
        conversaciones[jid] = { ultimoComando: "ERROR_VERIFICACION", planSeleccionado, hora: Date.now() };
      }
      return;
    }

    // ─── Flujo RENOVAR paso 2: esperando USUARIO existente ─────────
    if (estadoAnterior?.esperandoUsuarioRenovar) {
      const usuarioIngresado = texto.trim();
      conversaciones[jid] = {
        ultimoComando: "USUARIO_RENOVAR_CAPTURADO",
        flujo: "renovar",
        usuarioRenovar: usuarioIngresado,
        hora: Date.now(),
      };
      await enviarConDelay(jid, `👤 *Usuario registrado:* _${usuarioIngresado}_\n\n📋 Ahora elige el plan para renovar:\n\n*1 DISPOSITIVO:*\n• *P1* — 1 mes — Bs 29\n• *P2* — 3 meses — Bs 82\n• *P3* — 6 meses — Bs 155\n• *P4* — 12 meses — Bs 300\n\n*2 DISPOSITIVOS:*\n• *Q1* — 1 mes — Bs 35\n• *Q2* — 3 meses — Bs 100\n• *Q3* — 6 meses — Bs 190\n• *Q4* — 12 meses — Bs 380\n\n*3 DISPOSITIVOS:*\n• *R1* — 1 mes — Bs 40\n• *R2* — 3 meses — Bs 115\n• *R3* — 6 meses — Bs 225\n• *R4* — 12 meses — Bs 440\n\nEscribe el código del plan (ej: *P1*, *Q2*, *R3*)`);
      return;
    }

    // ─── VERIFICAR: Iniciar flujo multi-paso ───────────────────────
    if (textoUpper === "VERIFICAR") {
      conversaciones[jid] = {
        ultimoComando: "ESPERANDO_NOMBRE",
        planSeleccionado: estadoAnterior?.planSeleccionado,
        flujo: estadoAnterior?.flujo,
        usuarioRenovar: estadoAnterior?.usuarioRenovar,
        hora: Date.now(),
        esperandoVerificacion: "nombre",
      };
      await enviarConDelay(jid, `🔐 *Verificación de pago*\n\nPara confirmar tu pago necesito dos datos que aparecen en tu comprobante de Yape:\n\n*Paso 1 de 2:*\n👤 ¿Cuál es tu *nombre completo* exactamente como aparece en el comprobante?\n\n_Escríbelo tal cual, en mayúsculas o minúsculas._`);
      return;
    }

    // ─── RENOVAR: Iniciar flujo de renovación ──────────────────────
    if (textoUpper === "RENOVAR") {
      conversaciones[jid] = {
        ultimoComando: "ESPERANDO_USUARIO_RENOVAR",
        flujo: "renovar",
        esperandoUsuarioRenovar: true,
        hora: Date.now(),
      };
      await enviarConDelay(jid, `🔄 *Renovación de cuenta*\n\n¿Cuál es tu *usuario actual*?\n\n_Escríbelo tal como lo recibiste cuando activaste tu cuenta (ej: zk59176930026)_`);
      return;
    }

    // ─── Comandos especiales (HOLA, MENU, AYUDA, ESTADO, ERRORES...) ──
    if (COMANDOS_ESPECIALES[textoUpper]) {
      const respuestas = COMANDOS_ESPECIALES[textoUpper];
      for (const resp of respuestas) {
        if (resp.tipo === "text") {
          await enviarConDelay(jid, resp.contenido);
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
          await enviarConDelay(jid, resp.contenido);
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
          flujo: estadoAnterior?.flujo,
          usuarioRenovar: estadoAnterior?.usuarioRenovar,
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
      await enviarConDelay(jid, SALUDO_INICIAL);
      return;
    }

    // ─── Respuesta por defecto ──────────────────────────────────────
    await enviarConDelay(jid, RESPUESTA_DESCONOCIDA);
  } catch (err) {
    console.error("❌ Error en manejarMensaje:", err);
    await enviarConDelay(jid, "❌ Hubo un error. Por favor intenta de nuevo.")
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
