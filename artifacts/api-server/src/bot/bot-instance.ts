/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                      BOT INSTANCE                                    ║
 * ║  Encapsula una instancia completa del bot de WhatsApp para un       ║
 * ║  tenant. Cada tenant tiene su propio BotInstance con estado          ║
 * ║  aislado: sock, conversaciones, sesión WhatsApp, etc.               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

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
import https from "https";
import querystring from "querystring";

import type { TenantConfig } from "./tenant-config.js";
import { SheetsService } from "./sheets-tenant.js";
import { CrmService, PLAN_ID_MAP } from "./crm-tenant.js";
import { GmailService } from "./gmail-tenant.js";
import {
  SALUDO_INICIAL,
  RESPUESTAS_NUMEROS,
  RESPUESTA_DESCONOCIDA,
  COMANDOS_ESPECIALES,
  ACTIVACION_EXITOSA,
  PALABRAS_SALUDO,
} from "./responses.js";
import { enviarImagen } from "./media-handler.js";
import { registrarPedido } from "./payment-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEOS_DIR = path.resolve(__dirname, "../../public/videos");
const BASE_AUTH_DIR = path.resolve(__dirname, "../../auth_info_baileys");

const logger = pino({ level: "silent" });

interface EstadoConversacion {
  ultimoComando: string;
  planSeleccionado?: string;
  hora: number;
  esperandoVerificacion?: "nombre" | "monto";
  nombreVerificacion?: string;
  flujo?: "nuevo" | "renovar";
  usuarioRenovar?: string;
  esperandoUsuarioRenovar?: boolean;
  esperandoUsuarioConsultar?: boolean;
}

type EstadoConexion = "desconectado" | "esperando_qr" | "esperando_codigo" | "conectado";

export class BotInstance {
  readonly tenant: TenantConfig;
  readonly sheets: SheetsService;
  readonly crm: CrmService;
  readonly gmail: GmailService;

  private sock: ReturnType<typeof makeWASocket> | null = null;
  private estadoConexion: EstadoConexion = "desconectado";
  private botActivo = true;
  private ultimoQR: string | null = null;
  private codigoPareoPendiente: string | null = null;
  private intentosReconexion = 0;
  private detenido = false;

  private conversaciones: Record<string, EstadoConversacion> = {};
  private chatsSilenciados = new Set<string>();
  private lidAlPhone: Map<string, string> = new Map();

  private authFolder: string;
  private lidMapFile: string;

  constructor(tenant: TenantConfig) {
    this.tenant = tenant;
    this.sheets = new SheetsService(tenant);
    this.crm = new CrmService(tenant);
    this.gmail = new GmailService(tenant, this.sheets);

    this.authFolder = path.join(BASE_AUTH_DIR, tenant.id);
    this.lidMapFile = path.join(BASE_AUTH_DIR, `${tenant.id}_lid_map.json`);

    this.cargarLidMap();
  }

  // ── LID Map ────────────────────────────────────────────────────────────────

  private cargarLidMap(): void {
    try {
      if (fs.existsSync(this.lidMapFile)) {
        const raw = fs.readFileSync(this.lidMapFile, "utf-8");
        const obj: Record<string, string> = JSON.parse(raw);
        for (const [k, v] of Object.entries(obj)) this.lidAlPhone.set(k, v);
        console.log(`📂 [LID][${this.tenant.id}] ${Object.keys(obj).length} entradas cargadas`);
      }
    } catch { /* ignorar */ }
  }

  private guardarLidMap(): void {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.lidAlPhone) obj[k] = v;
    fs.writeFile(this.lidMapFile, JSON.stringify(obj, null, 2), () => {});
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private extraerTelefono(jid: string): string {
    let jidReal = jid;
    if (jid.endsWith("@lid")) jidReal = this.lidAlPhone.get(jid) ?? jid;
    let num = jidReal.split("@")[0];
    if (num.length >= 12 && num.startsWith("1")) num = num.substring(1);
    return num;
  }

  private leerVideoLocal(nombre: string): Buffer | null {
    try {
      const filePath = path.join(VIDEOS_DIR, nombre.endsWith(".mp4") ? nombre : `${nombre}.mp4`);
      return fs.readFileSync(filePath);
    } catch { return null; }
  }

  private async enviarVideo(jid: string, contenido: string, caption?: string): Promise<void> {
    if (!this.sock) return;
    if (contenido.startsWith("http")) {
      await this.sock.sendMessage(jid, { video: { url: contenido }, caption });
    } else {
      const buffer = this.leerVideoLocal(contenido);
      if (buffer) {
        await this.sock.sendMessage(jid, { video: buffer, caption });
      } else {
        await this.enviarConDelay(jid, `⚠️ Video no disponible temporalmente. Escribe *3* para soporte.`);
      }
    }
  }

  private async enviarConDelay(jid: string, texto: string): Promise<void> {
    if (!this.sock) return;
    await new Promise(r => setTimeout(r, 300 + Math.random() * 900));
    await this.sock.sendPresenceUpdate("composing", jid).catch(() => {});
    const base = Math.min(Math.max(texto.length * 30, 2000), 5000);
    await new Promise(r => setTimeout(r, base + (Math.random() * 600 - 300)));
    await this.sock.sendPresenceUpdate("paused", jid).catch(() => {});
    await this.sock.sendMessage(jid, { text: texto });
  }

  private async enviarNotificacionPushover(params: { titulo: string; mensaje: string; telefono?: string }): Promise<void> {
    const appToken = this.tenant.pushoverApiToken ?? process.env["PUSHOVER_APP_TOKEN"];
    const userKey = this.tenant.pushoverUserKey ?? process.env["PUSHOVER_USER_KEY"];
    if (!appToken || !userKey) return;

    const url = params.telefono ? `https://wa.me/${params.telefono.replace(/\D/g, "")}` : undefined;
    const payload: Record<string, string> = {
      token: appToken, user: userKey,
      title: params.titulo, message: params.mensaje,
      sound: "pushover", priority: "0",
    };
    if (url) { payload["url"] = url; payload["url_title"] = "Abrir chat en WhatsApp"; }

    const body = querystring.stringify(payload);
    return new Promise((resolve) => {
      const req = https.request({
        hostname: "api.pushover.net", path: "/1/messages.json", method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve());
      });
      req.on("error", () => resolve());
      req.write(body);
      req.end();
    });
  }

  // ── Comandos del dueño ─────────────────────────────────────────────────────

  private readonly COMANDOS_DUENO: Record<string, (jid: string) => Promise<string>> = {
    "/stop": async (jid) => { this.chatsSilenciados.add(jid); return "🔇 Bot silenciado en este chat."; },
    "/start": async (jid) => { this.chatsSilenciados.delete(jid); return "🔊 Bot reactivado en este chat."; },
    "/status": async (jid) => {
      return `📊 *Estado del bot*\n\n• Tenant: ${this.tenant.nombre}\n• Global: ${this.botActivo ? "✅ Activo" : "⏸️ Pausado"}\n• Este chat: ${this.chatsSilenciados.has(jid) ? "🔇 Silenciado" : "🔊 Activo"}`;
    },
    "/silenciados": async (_jid) => {
      if (this.chatsSilenciados.size === 0) return "📋 No hay chats silenciados.";
      return `📋 *Chats silenciados (${this.chatsSilenciados.size}):*\n\n${[...this.chatsSilenciados].map((j, i) => `${i + 1}. ${this.extraerTelefono(j)}`).join("\n")}`;
    },
    "/limpiar": async (_jid) => {
      const total = this.chatsSilenciados.size;
      this.chatsSilenciados.clear();
      return total === 0 ? "📋 No había chats silenciados." : `✅ Se reactivaron *${total}* chat${total === 1 ? "" : "s"}.`;
    },
    "/num": async (jid) => {
      if (jid.endsWith("@lid")) {
        const jidReal = this.lidAlPhone.get(jid);
        if (jidReal) {
          let tel = jidReal.split("@")[0];
          if (tel.length >= 12 && tel.startsWith("1")) tel = tel.substring(1);
          return tel;
        }
      }
      return jid.split("@")[0];
    },
  };

  // ── Manejador de mensajes ──────────────────────────────────────────────────

  private async manejarMensaje(jid: string, texto: string): Promise<void> {
    const textoUpper = texto.toUpperCase().trim();
    const estadoAnterior = this.conversaciones[jid];
    this.conversaciones[jid] = {
      ultimoComando: textoUpper,
      planSeleccionado: estadoAnterior?.planSeleccionado,
      flujo: estadoAnterior?.flujo,
      usuarioRenovar: estadoAnterior?.usuarioRenovar,
      hora: Date.now(),
    };

    try {
      // ── DEMO ───────────────────────────────────────────────────────
      if (textoUpper === "DEMO1" || textoUpper === "DEMO3") {
        const planClave = textoUpper === "DEMO1" ? "DEMO_1H" : "DEMO_3H";
        const planInfo = PLAN_ID_MAP[planClave];
        const telefono = this.extraerTelefono(jid);

        const yaExisteDemo = await this.crm.verificarDemoExistente(telefono);
        if (yaExisteDemo) {
          await this.enviarConDelay(jid, `⚠️ *No es posible crear la cuenta*\n\nEste número ya generó una cuenta gratuita previamente.\n\nEscribe *1* para ver nuestros planes. 🚀`);
          return;
        }

        await this.enviarConDelay(jid, `⏳ *Creando tu cuenta de prueba...*\n\n🎁 ${planInfo?.nombre ?? planClave}\n\n_Esto toma unos segundos, por favor espera..._`);

        const usernamesEnUso = new Set<string>();
        const resultado = await this.crm.crearCuenta(planClave, `Demo_${telefono}`, `${telefono}@bot.bo`, telefono, usernamesEnUso);

        if (resultado.ok && resultado.usuario) {
          const mensajeActivacion = ACTIVACION_EXITOSA({
            usuario: resultado.usuario, contrasena: resultado.contrasena ?? "",
            plan: `🎁 ${resultado.plan ?? planInfo?.nombre ?? planClave} (DEMO GRATUITO)`,
            servidor: resultado.servidor,
          });
          await this.enviarConDelay(jid, mensajeActivacion);
          await this.enviarConDelay(jid, `💡 *¿Te gustó la prueba?*\n\nEscribe *1* para ver nuestros planes completos. 🚀`);
          this.conversaciones[jid] = { ultimoComando: "DEMO_CREADA", hora: Date.now() };
        } else {
          await this.enviarConDelay(jid, `⚠️ *No pudimos crear tu demo en este momento*\n\n${resultado.mensaje}\n\nEscribe *3* para contactar soporte.`);
        }
        return;
      }

      if (textoUpper === "CONFIRMAR") {
        await this.enviarConDelay(jid, `ℹ️ Para verificar tu pago, escribe *COMPROBAR*.\n\nSi aún no has pagado, elige tu plan escribiendo *1*.\n\nPara ver tus cuentas activas, escribe *VERIFICAR*.`);
        return;
      }

      // ── Flujo verificación: NOMBRE ─────────────────────────────────
      if (estadoAnterior?.esperandoVerificacion === "nombre") {
        const nombreIngresado = texto.trim();
        this.conversaciones[jid] = {
          ultimoComando: "ESPERANDO_MONTO",
          planSeleccionado: estadoAnterior.planSeleccionado,
          flujo: estadoAnterior.flujo,
          usuarioRenovar: estadoAnterior.usuarioRenovar,
          hora: Date.now(),
          esperandoVerificacion: "monto",
          nombreVerificacion: nombreIngresado,
        };
        await this.enviarConDelay(jid, `✍️ *Nombre registrado:* _${nombreIngresado}_\n\n💰 Ahora dime el *monto exacto* que pagaste.\n\nEscríbelo solo como número, por ejemplo: *29.00* o *29*`);
        return;
      }

      // ── Flujo verificación: MONTO ──────────────────────────────────
      if (estadoAnterior?.esperandoVerificacion === "monto") {
        const montoIngresado = parseFloat(texto.trim().replace(",", "."));
        const nombre = estadoAnterior.nombreVerificacion ?? "";
        const planSeleccionado = estadoAnterior.planSeleccionado;
        const telefono = this.extraerTelefono(jid);

        if (isNaN(montoIngresado)) {
          await this.enviarConDelay(jid, `⚠️ No entendí ese monto. Escríbelo solo como número, por ejemplo: *29.00* o *82*`);
          return;
        }

        const flujo = estadoAnterior.flujo ?? "nuevo";
        const usuarioRenovar = estadoAnterior.usuarioRenovar;

        if (planSeleccionado && PLAN_ID_MAP[planSeleccionado]) {
          const planInfo = PLAN_ID_MAP[planSeleccionado];
          if (montoIngresado < planInfo.monto || montoIngresado > planInfo.monto + 1) {
            this.conversaciones[jid] = {
              ultimoComando: "MONTO_INCORRECTO", planSeleccionado, flujo, usuarioRenovar,
              hora: Date.now(), esperandoVerificacion: "monto", nombreVerificacion: nombre,
            };
            await this.enviarConDelay(jid, `❌ *El monto no corresponde al plan seleccionado*\n\n📋 Plan: ${planInfo.nombre}\n💰 Esperado: *Bs ${planInfo.monto}*\n💸 Indicaste: Bs ${montoIngresado}\n\nIngresa de nuevo el monto exacto:`);
            return;
          }
        }

        await this.enviarConDelay(jid, `🔍 _Buscando tu pago en el sistema..._`);

        try {
          const resultadoPago = await this.sheets.buscarPagoSinUsar(nombre, montoIngresado);

          if (!resultadoPago.encontrado) {
            this.conversaciones[jid] = { ultimoComando: "VERIFICACION_FALLIDA", planSeleccionado, flujo, usuarioRenovar, hora: Date.now() };
            await this.enviarConDelay(jid, `❌ *No encontramos tu pago*\n\nBuscamos:\n👤 Nombre: _${nombre}_\n💰 Monto: _Bs ${montoIngresado}_\n\nEscribe *VERIFICAR* para intentarlo de nuevo o *3* para soporte.`);
            return;
          }

          const { rowNumber } = resultadoPago;

          if (!planSeleccionado || !PLAN_ID_MAP[planSeleccionado]) {
            const fechaUso = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
            await this.sheets.marcarPagoComoUsado(rowNumber, telefono, fechaUso);
            await this.enviarConDelay(jid, `✅ *Pago confirmado.*\n\nNo tenemos registrado qué plan elegiste.\n\nEscribe el código de tu plan (ej: *P1*, *Q2*) o escribe *3* para que te ayudemos.`);
            this.conversaciones[jid] = { ultimoComando: "PAGO_CONFIRMADO_SIN_PLAN", hora: Date.now() };
            return;
          }

          const planInfo = PLAN_ID_MAP[planSeleccionado];

          if (flujo === "renovar" && usuarioRenovar) {
            await this.enviarConDelay(jid, `✅ *¡Pago confirmado!*\n\n📋 Plan: ${planInfo.nombre}\n💰 Monto: Bs ${planInfo.monto}\n👤 Usuario: ${usuarioRenovar}\n\n⏳ _Renovando tu cuenta..._`);
            const resultado = await this.crm.renovarCuenta(usuarioRenovar, planSeleccionado);
            if (resultado.ok) {
              const fechaUso = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
              await this.sheets.marcarPagoComoUsado(rowNumber, telefono, fechaUso);
              await this.enviarConDelay(jid, `🎉 *¡Cuenta renovada exitosamente!*\n\n🔐 *Credenciales:*\n📛 Plataforma: \`mastv\`\n👤 Usuario: \`${resultado.usuario}\`\n🔑 Contraseña: \`${resultado.contrasena}\`\n🌐 URL: \`${resultado.servidor || "http://mtv.bo:80"}\`\n\n📺 Plan renovado: ${resultado.plan}`);
              this.sheets.actualizarCuenta(telefono, resultado.usuario ?? usuarioRenovar, resultado.plan ?? planSeleccionado, planInfo.dias).catch(() => {});
              this.conversaciones[jid] = { ultimoComando: "CUENTA_RENOVADA", hora: Date.now() };
            } else {
              await this.enviarConDelay(jid, `⚠️ *Pago confirmado pero hubo un problema al renovar*\n\n${resultado.mensaje}\n\nEscribe *3* para soporte.`);
              this.conversaciones[jid] = { ultimoComando: "ERROR_CRM_RENOVAR", planSeleccionado, hora: Date.now() };
            }
          } else {
            await this.enviarConDelay(jid, `✅ *¡Pago confirmado!*\n\n📋 Plan: ${planInfo.nombre}\n💰 Monto: Bs ${planInfo.monto}\n\n⏳ _Creando tu cuenta..._`);
            const usernamesEnUso = new Set<string>();
            const resultado = await this.crm.crearCuenta(planSeleccionado, `Cliente_${telefono}`, `${telefono}@bot.bo`, telefono, usernamesEnUso);
            if (resultado.ok && resultado.usuario) {
              const fechaUso = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
              await this.sheets.marcarPagoComoUsado(rowNumber, telefono, fechaUso);
              const mensajeActivacion = ACTIVACION_EXITOSA({
                usuario: resultado.usuario, contrasena: resultado.contrasena ?? "",
                plan: resultado.plan ?? planInfo.nombre, servidor: resultado.servidor,
              });
              await this.enviarConDelay(jid, mensajeActivacion);
              this.sheets.registrarCuenta(telefono, resultado.usuario, resultado.plan ?? planInfo.nombre, planInfo.dias).catch(() => {});
              this.conversaciones[jid] = { ultimoComando: "CUENTA_CREADA", hora: Date.now() };
            } else {
              await this.enviarConDelay(jid, `⚠️ *Pago confirmado pero hubo un problema al crear tu cuenta*\n\n${resultado.mensaje}\n\nEscribe *3* para soporte.`);
              this.conversaciones[jid] = { ultimoComando: "ERROR_CRM", planSeleccionado, hora: Date.now() };
            }
          }
        } catch (err) {
          console.error(`❌ [BOT][${this.tenant.id}] Error verificación:`, err);
          await this.enviarConDelay(jid, `⚠️ Error al consultar tu pago. Intenta de nuevo o escribe *3* para soporte.`);
        }
        return;
      }

      // ── Flujo CONSULTAR: esperando USUARIO ─────────────────────────
      if (estadoAnterior?.esperandoUsuarioConsultar) {
        const usuarioConsultar = texto.trim();
        this.conversaciones[jid] = { ultimoComando: "CONSULTANDO", hora: Date.now() };
        await this.enviarConDelay(jid, `🔍 _Consultando tu cuenta *${usuarioConsultar}*..._`);
        const estado = await this.crm.consultarEstadoCuenta(usuarioConsultar);
        if (!estado.ok || !estado.usuario) {
          await this.enviarConDelay(jid, `❌ *Cuenta no encontrada*\n\n${estado.mensaje}\n\nEscribe *CONSULTAR* para intentar de nuevo o *3* para soporte.`);
          return;
        }
        let msg = `📋 *Estado de tu cuenta ${this.tenant.nombreEmpresa}*\n\n👤 *Usuario:* \`${estado.usuario}\`\n`;
        if (estado.plan) msg += `📺 *Plan:* ${estado.plan}\n`;
        if (estado.maxConexiones !== undefined) msg += `📱 *Dispositivos:* ${estado.maxConexiones}\n`;
        msg += "\n";
        if (estado.diasRestantes !== undefined) {
          if (estado.diasRestantes <= 0) {
            msg += `🔴 *Estado:* VENCIDA\n📅 *Venció:* ${estado.fechaExpiracion}\n\n⚠️ Escribe *RENOVAR* para renovarla.`;
          } else if (estado.diasRestantes <= 5) {
            msg += `🟡 *Estado:* PRÓXIMA A VENCER\n📅 *Vence:* ${estado.fechaExpiracion}\n⏳ *Días restantes:* *${estado.diasRestantes}*\n\n⚠️ Escribe *RENOVAR* para extenderla.`;
          } else {
            msg += `🟢 *Estado:* ACTIVA\n📅 *Vence:* ${estado.fechaExpiracion}\n⏳ *Días restantes:* *${estado.diasRestantes}*`;
          }
        }
        msg += "\n\n*RENOVAR* → Renovar\n*MENU* → Menú principal";
        await this.enviarConDelay(jid, msg);
        this.conversaciones[jid] = { ultimoComando: "CONSULTA_EXITOSA", hora: Date.now() };
        return;
      }

      // ── Flujo RENOVAR: esperando USUARIO ───────────────────────────
      if (estadoAnterior?.esperandoUsuarioRenovar) {
        const usuarioIngresado = texto.trim();
        this.conversaciones[jid] = { ultimoComando: "USUARIO_RENOVAR_CAPTURADO", flujo: "renovar", usuarioRenovar: usuarioIngresado, hora: Date.now() };
        await this.enviarConDelay(jid, `👤 *Usuario:* _${usuarioIngresado}_\n\n📋 Elige el plan para renovar:\n\n*1 DISPOSITIVO:*\n• *P1* — 1 mes — Bs 29\n• *P2* — 3 meses — Bs 82\n• *P3* — 6 meses — Bs 155\n• *P4* — 12 meses — Bs 300\n\n*2 DISPOSITIVOS:*\n• *Q1* — 1 mes — Bs 35\n• *Q2* — 3 meses — Bs 100\n• *Q3* — 6 meses — Bs 190\n• *Q4* — 12 meses — Bs 380\n\n*3 DISPOSITIVOS:*\n• *R1* — 1 mes — Bs 40\n• *R2* — 3 meses — Bs 115\n• *R3* — 6 meses — Bs 225\n• *R4* — 12 meses — Bs 440`);
        return;
      }

      if (textoUpper === "CONSULTAR" || textoUpper === "7") {
        this.conversaciones[jid] = { ultimoComando: "ESPERANDO_USUARIO_CONSULTAR", hora: Date.now(), esperandoUsuarioConsultar: true };
        await this.enviarConDelay(jid, `📅 *Consulta de días restantes*\n\n¿Cuál es tu *nombre de usuario*?\n\n_Escríbelo tal como lo recibiste al activar tu cuenta_`);
        return;
      }

      if (textoUpper === "8") {
        const telefono = this.extraerTelefono(jid);
        await this.enviarConDelay(jid, `💬 *Solicitud recibida*\n\nHemos notificado al administrador. En breve se comunicará contigo. 🙏`);
        this.enviarNotificacionPushover({ titulo: "💬 Solicitud de atención", mensaje: `Cliente +${telefono} quiere hablar personalmente en ${this.tenant.nombreEmpresa}.`, telefono }).catch(() => {});
        this.conversaciones[jid] = { ultimoComando: "8", hora: Date.now() };
        return;
      }

      if (textoUpper === "VERIFICAR") {
        const telefono = this.extraerTelefono(jid);
        await this.enviarConDelay(jid, `🔍 _Buscando tus cuentas registradas..._`);
        try {
          const cuentas = await this.sheets.buscarCuentasPorTelefono(telefono);
          if (cuentas.length === 0) {
            await this.enviarConDelay(jid, `📋 *No encontramos cuentas asociadas a tu número*\n\nTu número: *${telefono}*\n\n*1* → Ver planes\n*4* → Activar servicio\n*3* → Soporte`);
          } else {
            let msg = `✅ *Tus cuentas activas en ${this.tenant.nombreEmpresa}*\n\n📱 Número: *${telefono}*\n\n`;
            cuentas.forEach((c, i) => {
              msg += `*Cuenta ${i + 1}:*\n${c.estado === "RENOVADA" ? "🔄" : "🟢"} Estado: *${c.estado}*\n👤 Usuario: \`${c.usuario}\`\n📺 Plan: ${c.plan}\n📅 Renovación: ${c.fecha}\n`;
              if (c.fechaExpiracion) msg += `⏳ Expira: ${c.fechaExpiracion}\n`;
              if (i < cuentas.length - 1) msg += "\n";
            });
            msg += "\n\n*RENOVAR* → Renovar\n*7* → Días restantes";
            await this.enviarConDelay(jid, msg);
          }
        } catch (err) {
          console.error(`[BOT][${this.tenant.id}] Error VERIFICAR:`, err);
          await this.enviarConDelay(jid, `⚠️ No pudimos consultar tus cuentas. Escribe *7* o *3* para soporte.`);
        }
        this.conversaciones[jid] = { ultimoComando: "VERIFICAR", hora: Date.now() };
        return;
      }

      if (textoUpper === "COMPROBAR") {
        this.conversaciones[jid] = {
          ultimoComando: "ESPERANDO_NOMBRE",
          planSeleccionado: estadoAnterior?.planSeleccionado,
          flujo: estadoAnterior?.flujo,
          usuarioRenovar: estadoAnterior?.usuarioRenovar,
          hora: Date.now(),
          esperandoVerificacion: "nombre",
        };
        await this.enviarConDelay(jid, `🔐 *Verificación de pago*\n\n*Paso 1 de 2:*\n👤 ¿Cuál es tu *nombre completo* exactamente como aparece en el comprobante?`);
        return;
      }

      if (textoUpper === "RENOVAR") {
        this.conversaciones[jid] = { ultimoComando: "ESPERANDO_USUARIO_RENOVAR", flujo: "renovar", esperandoUsuarioRenovar: true, hora: Date.now() };
        await this.enviarConDelay(jid, `🔄 *Renovación de cuenta*\n\n¿Cuál es tu *usuario actual*?\n\n_Escríbelo tal como lo recibiste al activar_`);
        return;
      }

      // ── Comandos especiales ────────────────────────────────────────
      if (COMANDOS_ESPECIALES[textoUpper]) {
        for (const resp of COMANDOS_ESPECIALES[textoUpper]) {
          if (resp.tipo === "text") await this.enviarConDelay(jid, resp.contenido);
          else if (resp.tipo === "video") await this.enviarVideo(jid, resp.contenido, resp.caption);
          else if (resp.tipo === "image") await this.sock!.sendMessage(jid, { image: { url: resp.contenido }, caption: resp.caption });
        }
        return;
      }

      // ── Respuestas por número/letra ────────────────────────────────
      if (RESPUESTAS_NUMEROS[textoUpper]) {
        const respuestas = RESPUESTAS_NUMEROS[textoUpper];
        for (const resp of respuestas) {
          if (resp.tipo === "text") await this.enviarConDelay(jid, resp.contenido);
          else if (resp.tipo === "video") await this.enviarVideo(jid, resp.contenido, resp.caption);
          else if (resp.tipo === "image") await this.sock!.sendMessage(jid, { image: { url: resp.contenido }, caption: resp.caption });
        }

        const PLANES_VALIDOS = new Set(Object.keys(PLAN_ID_MAP));
        const esPlanPagado = PLANES_VALIDOS.has(textoUpper) && !textoUpper.startsWith("DEMO");
        if (esPlanPagado) {
          const qrPath = path.join(__dirname, "../../public/images/qr-pago.jpeg");
          if (fs.existsSync(qrPath)) {
            const qrBuffer = fs.readFileSync(qrPath);
            await this.sock!.sendMessage(jid, { image: qrBuffer, caption: `📲 *Escanea este QR para pagar*\n\nUna vez realizado el pago, escribe *COMPROBAR*.` });
          }
          this.conversaciones[jid] = {
            ultimoComando: textoUpper, planSeleccionado: textoUpper,
            flujo: estadoAnterior?.flujo, usuarioRenovar: estadoAnterior?.usuarioRenovar, hora: Date.now(),
          };
          const telefono = this.extraerTelefono(jid);
          const planInfo = PLAN_ID_MAP[textoUpper];
          if (planInfo) registrarPedido(telefono, textoUpper, planInfo.monto);
        }
        return;
      }

      // ── Saludos ────────────────────────────────────────────────────
      const esUnSaludo = PALABRAS_SALUDO.some((p) => textoUpper.includes(p));
      if (esUnSaludo) {
        await this.enviarConDelay(jid, SALUDO_INICIAL);
        return;
      }

      await this.enviarConDelay(jid, RESPUESTA_DESCONOCIDA);
    } catch (err) {
      console.error(`❌ [BOT][${this.tenant.id}] Error manejarMensaje:`, err);
      await this.enviarConDelay(jid, "❌ Hubo un error. Por favor intenta de nuevo.").catch(() => {});
    }
  }

  // ── API pública ────────────────────────────────────────────────────────────

  getEstado() {
    return {
      tenantId: this.tenant.id,
      nombre: this.tenant.nombre,
      conectado: this.estadoConexion === "conectado",
      estado: this.estadoConexion,
      botActivo: this.botActivo,
      conversacionesActivas: Object.keys(this.conversaciones).length,
      chatsSilenciados: this.chatsSilenciados.size,
      tieneQR: this.ultimoQR !== null,
      codigoPareoPendiente: this.codigoPareoPendiente,
      gmail: this.gmail.getEstado(),
    };
  }

  setBotActivo(valor: boolean): void {
    this.botActivo = valor;
    console.log(`🤖 [BOT][${this.tenant.id}] ${valor ? "ACTIVADO ✅" : "DESACTIVADO ⏸️"}`);
  }

  async enviarMensaje(telefono: string, mensaje: string): Promise<void> {
    if (!this.sock) throw new Error("Bot no conectado");
    const jid = telefono.includes("@s.whatsapp.net") ? telefono : `${telefono}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text: mensaje });
  }

  async solicitarCodigoPareo(telefono: string): Promise<string> {
    if (!this.sock) throw new Error("Socket no inicializado");
    if (this.estadoConexion === "conectado") throw new Error("El bot ya está conectado.");
    const numeroLimpio = telefono.replace(/\D/g, "");
    if (!numeroLimpio || numeroLimpio.length < 10) throw new Error("Número inválido.");
    const codigo = await this.sock.requestPairingCode(numeroLimpio);
    this.codigoPareoPendiente = codigo;
    this.estadoConexion = "esperando_codigo";
    console.log(`\n📱 [BOT][${this.tenant.id}] CÓDIGO DE VINCULACIÓN: ${codigo}\n`);
    return codigo;
  }

  borrarSesion(): void {
    if (fs.existsSync(this.authFolder)) {
      fs.rmSync(this.authFolder, { recursive: true, force: true });
      fs.mkdirSync(this.authFolder, { recursive: true });
    }
  }

  detener(): void {
    this.detenido = true;
    this.sheets.detenerCache();
    this.gmail.detener();
    this.sock?.end(undefined);
    this.sock = null;
    this.estadoConexion = "desconectado";
    console.log(`🔴 [BOT][${this.tenant.id}] Detenido`);
  }

  // ── Conexión WhatsApp ──────────────────────────────────────────────────────

  async conectar(): Promise<void> {
    if (this.detenido) return;

    fs.mkdirSync(this.authFolder, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version, logger,
      printQRInTerminal: false,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      downloadHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      shouldIgnoreJid: (jid) => jid.endsWith("@g.us") || jid.endsWith("@broadcast"),
    });

    this.sock.ev.on("connection.update", (update) => {
      if (this.detenido) return;
      const { connection, lastDisconnect, qr } = update;
      console.log(`🔔 [BOT][${this.tenant.id}] connection=${connection ?? "undefined"} hasQR=${!!qr}`);

      if (qr) {
        this.ultimoQR = qr;
        this.estadoConexion = "esperando_qr";
        this.intentosReconexion = 0;
        console.log(`\n📱 [BOT][${this.tenant.id}] ESCANEA EL QR CON WHATSAPP:\n`);
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        const err = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
        const razon = err?.output?.statusCode;
        this.estadoConexion = "desconectado";
        this.ultimoQR = null;
        this.codigoPareoPendiente = null;
        console.log(`🔴 [BOT][${this.tenant.id}] Conexión cerrada. Razón: ${razon}`);

        if (razon === DisconnectReason.loggedOut) {
          this.sock = null;
          this.borrarSesion();
          this.intentosReconexion = 0;
          if (!this.detenido) setTimeout(() => this.conectar(), 3000);
        } else {
          this.intentosReconexion++;
          const delay = Math.min(5000 * Math.pow(1.5, this.intentosReconexion - 1), 30000);
          console.log(`⏳ [BOT][${this.tenant.id}] Reconectando en ${Math.round(delay / 1000)}s...`);
          if (!this.detenido) setTimeout(() => this.conectar(), delay);
        }
      }

      if (connection === "open") {
        this.estadoConexion = "conectado";
        this.ultimoQR = null;
        this.codigoPareoPendiente = null;
        this.intentosReconexion = 0;
        console.log(`✅ [BOT][${this.tenant.id}] Conectado!`);
      }
    });

    this.sock.ev.on("creds.update", saveCreds);

    const actualizarLids = (contacts: Array<{ lid?: string; id?: string }>) => {
      const nuevos: Array<{ lid: string; jidReal: string }> = [];
      for (const c of contacts) {
        if (c.lid && c.id) {
          const esNuevo = !this.lidAlPhone.has(c.lid);
          this.lidAlPhone.set(c.lid, c.id);
          if (esNuevo) nuevos.push({ lid: c.lid, jidReal: c.id });
        }
      }
      if (nuevos.length > 0) {
        this.guardarLidMap();
        for (const { lid, jidReal } of nuevos) {
          const lidNum = lid.split("@")[0];
          let telReal = jidReal.split("@")[0];
          if (telReal.length >= 12 && telReal.startsWith("1")) telReal = telReal.substring(1);
          this.sheets.actualizarTelefonoPorLid(lidNum, telReal).catch(() => {});
        }
      }
    };

    this.sock.ev.on("contacts.upsert", actualizarLids);
    this.sock.ev.on("contacts.update", actualizarLids);

    this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (!msg.message) continue;
        const remitente = msg.key.remoteJid;
        if (!remitente || remitente.endsWith("@g.us") || remitente.endsWith("@broadcast")) continue;

        const texto = msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption || "";

        if (!texto) continue;

        if (msg.key.fromMe) {
          const comando = texto.trim().toLowerCase();
          const accion = this.COMANDOS_DUENO[comando];
          if (accion) {
            const respuesta = await accion(remitente).catch(() => "❌ Error ejecutando el comando.");
            await this.sock!.sendMessage(remitente, { text: respuesta }).catch(() => {});
          }
          continue;
        }

        if (!this.botActivo) continue;
        if (this.chatsSilenciados.has(remitente)) continue;

        console.log(`📩 [BOT][${this.tenant.id}] Mensaje de ${remitente}: "${texto}"`);
        await this.manejarMensaje(remitente, texto.trim()).catch((err) => {
          console.error(`❌ [BOT][${this.tenant.id}] Error:`, err);
        });
      }
    });
  }

  async iniciar(): Promise<void> {
    console.log(`🚀 [BOT][${this.tenant.id}] Iniciando...`);

    try {
      await this.sheets.inicializarHojas();
      this.sheets.iniciarCache();
    } catch (err) {
      console.error(`⚠️ [SHEETS][${this.tenant.id}] Error:`, err);
    }

    await this.conectar();

    // Configurar callback Gmail → WhatsApp admin
    this.gmail.setCallbackPagoDetectado((nombre, monto) => {
      const jid = `${this.tenant.adminWhatsapp.replace(/\D/g, "")}@s.whatsapp.net`;
      const msg = `💰 *Nuevo pago detectado*\n\n👤 Nombre: *${nombre}*\n💵 Monto: *Bs ${monto}*\n\n_El cliente debe escribir *COMPROBAR* para activar su cuenta._`;
      this.enviarMensaje(jid, msg).catch(() => {});
    });

    await this.gmail.iniciar();
  }
}
