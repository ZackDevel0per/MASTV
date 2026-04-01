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
import axios from "axios";

import type { TenantConfig, TenantPlan } from "./tenant-config.js";
import { SheetsService } from "./sheets-tenant.js";
import { CrmService, PLAN_ID_MAP } from "./crm-tenant.js";
import { GmailService } from "./gmail-tenant.js";
import { VeriPagosService } from "./veripagos-service.js";
import {
  generarSaludoInicial,
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
  // VeriPagos: ID del movimiento activo esperando confirmación de pago
  qrMovimientoId?: string;
}

interface PollQRData {
  intervalId: ReturnType<typeof setInterval>;
  movimientoId: string;
  planCmd: string;
  expiry: Date;
  flujo: "nuevo" | "renovar";
  usuarioRenovar?: string;
}

/** Si está en false, el flujo COMPROBAR (Gmail legacy) está deshabilitado */
const LEGACY_PAGO_GMAIL = false;

type EstadoConexion = "desconectado" | "esperando_qr" | "esperando_codigo" | "conectado";

export class BotInstance {
  tenant: TenantConfig;
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

  private qrPagoBuffer: Buffer | null = null;
  private veripagos: VeriPagosService | null = null;
  private pollingQR: Map<string, PollQRData> = new Map();

  constructor(tenant: TenantConfig) {
    this.tenant = tenant;
    this.sheets = new SheetsService(tenant);
    this.crm = new CrmService(tenant);
    this.gmail = new GmailService(tenant, this.sheets);

    this.authFolder = path.join(BASE_AUTH_DIR, tenant.id);
    this.lidMapFile = path.join(BASE_AUTH_DIR, `${tenant.id}_lid_map.json`);

    this.cargarLidMap();
    this.initVeriPagos(tenant);
  }

  private initVeriPagos(tenant: TenantConfig): void {
    if (tenant.veripagosUsername && tenant.veripagosPassword) {
      this.veripagos = new VeriPagosService(tenant.veripagosUsername, tenant.veripagosPassword);
    } else {
      this.veripagos = null;
    }
  }

  // ── VeriPagos: generación de QR único + polling automático ─────────────────

  private cancelarPollVeriPagos(jid: string): void {
    const existing = this.pollingQR.get(jid);
    if (existing) {
      clearInterval(existing.intervalId);
      this.pollingQR.delete(jid);
    }
  }

  private cancelarTodosLosPolls(): void {
    for (const [, data] of this.pollingQR) clearInterval(data.intervalId);
    this.pollingQR.clear();
  }

  private async iniciarPagoVeriPagos(
    jid: string,
    planCmd: string,
    flujo: "nuevo" | "renovar",
    usuarioRenovar?: string,
  ): Promise<void> {
    if (!this.veripagos || !this.sock) return;

    const tenantPlan = this.getPlanPorComando(planCmd);
    const planInfo = PLAN_ID_MAP[planCmd];
    const monto = tenantPlan?.monto ?? planInfo?.monto ?? 0;
    const nombrePlan = tenantPlan?.nombre ?? planInfo?.nombre ?? planCmd;

    try {
      await this.enviarConDelay(jid, `⏳ _Generando tu QR de pago único..._`);

      const { qrBase64, movimientoId, expiry } = await this.veripagos.generarQR(
        monto,
        `${nombrePlan} - ${this.tenant.nombreEmpresa}`,
      );

      const qrBuffer = Buffer.from(qrBase64, "base64");
      const caption =
        `📲 *Escanea este QR para pagar*\n\n` +
        `📋 *Plan:* ${nombrePlan}\n` +
        `💰 *Monto:* Bs ${monto}\n\n` +
        `✅ El pago se verificará *automáticamente* cada 30 segundos.\n` +
        `⚠️ QR válido hasta las 23:59 de mañana.\n\n` +
        `_Si tienes algún problema, escribe *3* para soporte._`;

      await this.sock.sendMessage(jid, { image: qrBuffer, caption });
      await this.enviarConDelay(
        jid,
        `🔄 _Estamos monitoreando tu pago automáticamente. Recibirás tus credenciales al instante cuando se confirme._ ✨`,
      );

      this.conversaciones[jid] = {
        ultimoComando: planCmd,
        planSeleccionado: planCmd,
        flujo,
        usuarioRenovar,
        hora: Date.now(),
        qrMovimientoId: movimientoId,
      };

      this.cancelarPollVeriPagos(jid);

      const intervalId = setInterval(() => {
        this.verificarPollVeriPagos(jid, movimientoId, planCmd, flujo, usuarioRenovar, expiry).catch(
          () => {},
        );
      }, 30_000);

      this.pollingQR.set(jid, { intervalId, movimientoId, planCmd, expiry, flujo, usuarioRenovar });

      console.log(
        `💳 [VeriPagos][${this.tenant.id}] Polling iniciado para ${jid} — mov=${movimientoId}`,
      );
    } catch (err) {
      console.error(`❌ [VeriPagos][${this.tenant.id}] Error generando QR:`, err);
      await this.enviarConDelay(
        jid,
        `⚠️ No se pudo generar el QR de pago en este momento. Escribe *3* para soporte.`,
      );
    }
  }

  private async verificarPollVeriPagos(
    jid: string,
    movimientoId: string,
    planCmd: string,
    flujo: "nuevo" | "renovar",
    usuarioRenovar: string | undefined,
    expiry: Date,
  ): Promise<void> {
    if (!this.veripagos || !this.sock) {
      this.cancelarPollVeriPagos(jid);
      return;
    }

    if (new Date() > expiry) {
      this.cancelarPollVeriPagos(jid);
      await this.enviarConDelay(
        jid,
        `⏰ *Tu QR de pago expiró.*\n\nEscribe el código de tu plan (ej: *P1*, *Q2*) para generar un nuevo QR.`,
      );
      return;
    }

    try {
      const estado = await this.veripagos.verificarQR(movimientoId);
      if (estado === "pagado") {
        this.cancelarPollVeriPagos(jid);
        await this.procesarPagoConfirmadoVeriPagos(jid, planCmd, flujo, usuarioRenovar);
      } else if (estado === "error") {
        this.cancelarPollVeriPagos(jid);
        await this.enviarConDelay(
          jid,
          `⚠️ El QR expiró o tuvo un error. Escribe el plan de nuevo para generar un QR nuevo.`,
        );
      }
    } catch (err) {
      console.error(`[VeriPagos][${this.tenant.id}] Error verificando poll:`, err);
    }
  }

  private async procesarPagoConfirmadoVeriPagos(
    jid: string,
    planCmd: string,
    flujo: "nuevo" | "renovar",
    usuarioRenovar?: string,
  ): Promise<void> {
    const telefono = this.extraerTelefono(jid);
    const tenantPlan = this.getPlanPorComando(planCmd);
    const planInfo = PLAN_ID_MAP[planCmd];
    const monto = tenantPlan?.monto ?? planInfo?.monto ?? 0;
    const nombrePlan = tenantPlan?.nombre ?? planInfo?.nombre ?? planCmd;
    const dias = tenantPlan?.dias ?? planInfo?.dias ?? 30;

    console.log(`✅ [VeriPagos][${this.tenant.id}] Pago confirmado — jid=${jid} plan=${planCmd}`);

    await this.enviarConDelay(
      jid,
      `✅ *¡Pago confirmado por VeriPagos!*\n\n📋 Plan: ${nombrePlan}\n💰 Monto: Bs ${monto}\n\n⏳ _${flujo === "renovar" ? "Renovando tu cuenta..." : "Creando tu cuenta..."}_`,
    );

    if (flujo === "renovar" && usuarioRenovar) {
      const resultado = await this.crm.renovarCuenta(usuarioRenovar, planCmd);
      if (resultado.ok) {
        await this.enviarConDelay(
          jid,
          `🎉 *¡Cuenta renovada exitosamente!*\n\n🔐 *Credenciales:*\n📛 Plataforma: \`mastv\`\n👤 Usuario: \`${resultado.usuario}\`\n🔑 Contraseña: \`${resultado.contrasena}\`\n🌐 URL: \`${resultado.servidor || "http://mtv.bo:80"}\`\n\n📺 Plan renovado: ${resultado.plan}`,
        );
        this.sheets
          .actualizarCuenta(telefono, resultado.usuario ?? usuarioRenovar, resultado.plan ?? planCmd, dias)
          .catch(() => {});
      } else {
        await this.enviarConDelay(
          jid,
          `⚠️ *Pago confirmado pero hubo un error al renovar*\n\n${resultado.mensaje}\n\nEscribe *3* para soporte.`,
        );
      }
    } else {
      const usernamesEnUso = new Set<string>();
      const resultado = await this.crm.crearCuenta(
        planCmd,
        `Cliente_${telefono}`,
        `${telefono}@bot.bo`,
        telefono,
        usernamesEnUso,
      );
      if (resultado.ok && resultado.usuario) {
        const mensajeActivacion = this.interpolar(
          ACTIVACION_EXITOSA({
            usuario: resultado.usuario,
            contrasena: resultado.contrasena ?? "",
            plan: resultado.plan ?? nombrePlan,
            servidor: resultado.servidor,
          }),
        );
        await this.enviarConDelay(jid, mensajeActivacion);
        if (this.tenant.enlaceGrupo) {
          await this.enviarConDelay(
            jid,
            `📢 *¡Únete a nuestro grupo de anuncios!*\n\nRecibe novedades, actualizaciones y promociones exclusivas:\n\n${this.tenant.enlaceGrupo}`,
          );
        }
        this.sheets
          .registrarCuenta(telefono, resultado.usuario, resultado.plan ?? planCmd, dias)
          .catch(() => {});
      } else {
        await this.enviarConDelay(
          jid,
          `⚠️ *Pago confirmado pero hubo un error al crear la cuenta*\n\n${resultado.mensaje}\n\nEscribe *3* para soporte.`,
        );
      }
    }

    this.conversaciones[jid] = { ultimoComando: "PAGO_COMPLETADO_VERIPAGOS", hora: Date.now() };
  }

  /**
   * Actualiza la configuración del tenant en la instancia activa
   * sin desconectar WhatsApp. Útil para cambios como nombre de empresa,
   * planes, pushover, credenciales CRM/Gmail/Sheets, etc.
   */
  actualizarConfig(newTenant: TenantConfig): void {
    this.tenant = newTenant;
    this.sheets.actualizarConfig(newTenant);
    this.crm.actualizarConfig(newTenant);
    this.gmail.actualizarConfig(newTenant);
    this.initVeriPagos(newTenant);
    // Siempre recargar QR desde disco al actualizar config (puede haberse subido uno nuevo)
    this.qrPagoBuffer = null;
    this.precargarQR().catch(() => {});
    console.log(`🔄 [BOT] Config actualizada en caliente para tenant ${newTenant.id}`);
  }

  /**
   * Carga el QR de pago para este tenant.
   * Primero intenta leer desde disco local (más fiable que la URL que puede
   * cambiar entre sesiones de desarrollo). Si no existe en disco, descarga
   * desde la URL guardada en DB.
   */
  private async precargarQR(): Promise<void> {
    // Siempre intentar archivo local primero
    const localPath = path.resolve(__dirname, `../../public/qr-pagos/${this.tenant.id}.jpeg`);
    if (fs.existsSync(localPath)) {
      this.qrPagoBuffer = fs.readFileSync(localPath);
      console.log(`🖼️ [BOT][${this.tenant.id}] QR de pago cargado desde disco (${this.qrPagoBuffer.length} bytes)`);
      return;
    }
    // Fallback: descargar desde URL guardada en DB
    if (!this.tenant.qrPagoUrl) return;
    try {
      this.qrPagoBuffer = await this.resolverImagen(this.tenant.qrPagoUrl);
      console.log(`🖼️ [BOT][${this.tenant.id}] QR de pago descargado desde URL (${this.qrPagoBuffer.length} bytes)`);
    } catch (err) {
      console.error(`❌ [BOT][${this.tenant.id}] No se pudo precargar QR:`, err);
      this.qrPagoBuffer = null;
    }
  }

  /**
   * Reemplaza el placeholder {{EMPRESA}} con el nombre de empresa del tenant.
   */
  private interpolar(texto: string): string {
    return texto.replace(/\{\{EMPRESA\}\}/g, this.tenant.nombreEmpresa);
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

  /**
   * Extrae el número de teléfono SOLO desde JIDs @s.whatsapp.net para construir
   * un enlace wa.me válido (ej: wa.me/59169741630).
   * Si el JID es @lid, intenta resolverlo. Si no está en el mapa o el resultado
   * no es @s.whatsapp.net, devuelve undefined — nunca se usa el número crudo
   * del @lid porque genera números inválidos como 59167646040103.
   */
  private resolverTelefonoReal(jid: string): string | undefined {
    let jidResuelto = jid;

    if (jid.endsWith("@lid")) {
      const mapped = this.lidAlPhone.get(jid);
      if (!mapped || !mapped.endsWith("@s.whatsapp.net")) return undefined;
      jidResuelto = mapped;
    }

    if (!jidResuelto.endsWith("@s.whatsapp.net")) return undefined;

    let num = jidResuelto.split("@")[0];
    if (num.length >= 12 && num.startsWith("1")) num = num.substring(1);
    return num;
  }

  private leerVideoLocal(nombre: string): Buffer | null {
    try {
      const filePath = path.join(VIDEOS_DIR, nombre.endsWith(".mp4") ? nombre : `${nombre}.mp4`);
      return fs.readFileSync(filePath);
    } catch { return null; }
  }

  /**
   * Descarga una imagen desde una URL y la retorna como Buffer.
   * - Normaliza URLs de Imgur (página → URL directa con extensiones a probar)
   * - Usa axios con headers de navegador para evitar bloqueos de hotlinking
   * - Valida que la respuesta sea realmente una imagen
   */
  private async resolverImagen(url: string): Promise<Buffer> {
    const candidatos: string[] = [];

    // imgur.com/HASH o imgur.com/a/HASH → probar extensiones en i.imgur.com
    const imgurHash = /^https?:\/\/(?:www\.)?imgur\.com\/(?:a\/)?([a-zA-Z0-9]+)\/?$/.exec(url);
    // i.imgur.com/HASH (sin extensión) → añadir extensión
    const imgurDirect = /^https?:\/\/i\.imgur\.com\/([a-zA-Z0-9]+)\/?$/.exec(url);

    if (imgurHash) {
      const hash = imgurHash[1];
      candidatos.push(
        `https://i.imgur.com/${hash}.jpg`,
        `https://i.imgur.com/${hash}.png`,
        `https://i.imgur.com/${hash}.jpeg`,
        `https://i.imgur.com/${hash}.gif`,
      );
    } else if (imgurDirect) {
      const hash = imgurDirect[1];
      candidatos.push(
        `https://i.imgur.com/${hash}.jpg`,
        `https://i.imgur.com/${hash}.png`,
        `https://i.imgur.com/${hash}.jpeg`,
      );
    } else {
      candidatos.push(url);
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": "https://www.google.com/",
    };

    let lastError: unknown;
    for (const candidato of candidatos) {
      try {
        const res = await axios.get<ArrayBuffer>(candidato, {
          responseType: "arraybuffer",
          timeout: 15000,
          headers,
          maxRedirects: 5,
        });
        const contentType: string = res.headers["content-type"] ?? "";
        if (!contentType.startsWith("image/")) {
          console.warn(`⚠️ [BOT][${this.tenant.id}] URL devolvió ${contentType}, no es imagen: ${candidato}`);
          lastError = new Error(`Respuesta no es imagen (${contentType})`);
          continue;
        }
        return Buffer.from(res.data);
      } catch (err) {
        lastError = err;
        console.warn(`⚠️ [BOT][${this.tenant.id}] Falló descarga de ${candidato}:`, err);
      }
    }
    throw lastError ?? new Error(`No se pudo descargar imagen desde: ${url}`);
  }

  private async enviarQRPago(jid: string): Promise<void> {
    if (!this.sock) return;
    const caption = `📲 *Escanea este QR para pagar*\n\nUna vez realizado el pago, escribe *COMPROBAR*.`;
    if (this.qrPagoBuffer) {
      await this.sock.sendMessage(jid, { image: this.qrPagoBuffer, caption });
      return;
    }
    // Sin QR configurado para este tenant: enviar solo texto
    await this.enviarConDelay(jid, `📲 *Realiza tu pago y escribe COMPROBAR una vez completado.*`);
  }

  private async enviarImagen(jid: string, url: string, caption?: string): Promise<void> {
    if (!this.sock) return;
    try {
      const buffer = await this.resolverImagen(url);
      await this.sock.sendMessage(jid, { image: buffer, caption });
    } catch (err) {
      console.error(`❌ [BOT][${this.tenant.id}] Error enviando imagen desde ${url}:`, err);
      await this.enviarConDelay(jid, `⚠️ No se pudo cargar la imagen. Escribe *3* para soporte.`);
    }
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

  // ── Planes dinámicos por tenant ───────────────────────────────────────────

  private getPlanesPorDispositivos(dispositivos: number): TenantPlan[] {
    if (this.tenant.planes && this.tenant.planes.length > 0) {
      const filtrados = this.tenant.planes
        .filter(p => p.dispositivos === dispositivos)
        .sort((a, b) => a.monto - b.monto);
      if (filtrados.length > 0) return filtrados;
    }
    const prefijos: Record<number, string> = { 1: "P", 2: "Q", 3: "R" };
    const prefijo = prefijos[dispositivos];
    if (!prefijo) return [];
    const planes: TenantPlan[] = [];
    for (let i = 1; i <= 4; i++) {
      const key = `${prefijo}${i}`;
      const p = PLAN_ID_MAP[key];
      if (!p) continue;
      planes.push({
        codigo: key,
        nombre: p.nombre,
        monto: p.monto,
        descripcion: `💰 Bs ${p.monto}`,
        tolerancia: 1,
        dispositivos,
        duracion: `${p.dias} días`,
        dias: p.dias,
      });
    }
    return planes;
  }

  private getPlanPorComando(cmd: string): TenantPlan | null {
    const match = cmd.match(/^([PQR])(\d)$/);
    if (!match) return null;
    const [, prefijo, indexStr] = match;
    const dispositivos = prefijo === "P" ? 1 : prefijo === "Q" ? 2 : 3;
    const index = parseInt(indexStr, 10) - 1;
    return this.getPlanesPorDispositivos(dispositivos)[index] ?? null;
  }

  private generarMenuPlanesPorLetra(prefijo: "P" | "Q" | "R"): string {
    const dispositivos = prefijo === "P" ? 1 : prefijo === "Q" ? 2 : 3;
    const planes = this.getPlanesPorDispositivos(dispositivos);
    if (planes.length === 0) return `❌ No hay planes configurados para ${dispositivos} dispositivo(s).`;
    const titulo = `📺 *Planes - ${dispositivos} Dispositivo${dispositivos > 1 ? "s" : ""}*\n\n`;
    const lista = planes.map(p => `💰 *${p.duracion.toUpperCase()}* → Bs ${p.monto}`).join("\n");
    const acciones = planes.map((p, i) => `*${prefijo}${i + 1}* → Contratar (Bs ${p.monto})`).join("\n");
    return `${titulo}${lista}\n\n${acciones}`;
  }

  private generarConfirmacionPlan(cmd: string): string | null {
    const plan = this.getPlanPorComando(cmd);
    if (!plan) return null;
    return `✅ *Plan Seleccionado: ${plan.nombre}*\n💰 Bs ${plan.monto}\n\nPara completar tu activación:\n1️⃣ Realiza tu pago de *Bs ${plan.monto}* por Yape o QR\n2️⃣ Cuando termines, escribe *COMPROBAR*\n3️⃣ El bot te pedirá tu nombre y el monto exacto\n4️⃣ ¡Recibirás tus credenciales al instante!\n\n⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_\n\n*COMPROBAR* → Confirmar mi pago\n*1* → Volver al menú`;
  }

  private generarMenuRenovar(): string {
    const grupos: Array<{ prefijo: "P" | "Q" | "R"; label: string; disp: number }> = [
      { prefijo: "P", label: "1 DISPOSITIVO", disp: 1 },
      { prefijo: "Q", label: "2 DISPOSITIVOS", disp: 2 },
      { prefijo: "R", label: "3 DISPOSITIVOS", disp: 3 },
    ];
    const secciones = grupos.map(({ prefijo, label, disp }) => {
      const planes = this.getPlanesPorDispositivos(disp);
      if (planes.length === 0) return null;
      const lineas = planes.map((p, i) => `• *${prefijo}${i + 1}* — ${p.duracion} — Bs ${p.monto}`).join("\n");
      return `*${label}:*\n${lineas}`;
    }).filter(Boolean);
    return `📋 Elige el plan para renovar:\n\n${secciones.join("\n\n")}`;
  }

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
          const mensajeActivacion = this.interpolar(ACTIVACION_EXITOSA({
            usuario: resultado.usuario, contrasena: resultado.contrasena ?? "",
            plan: `🎁 ${resultado.plan ?? planInfo?.nombre ?? planClave} (DEMO GRATUITO)`,
            servidor: resultado.servidor,
          }));
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
          const tenantPlan = this.getPlanPorComando(planSeleccionado);
          const montoEsperado = tenantPlan?.monto ?? PLAN_ID_MAP[planSeleccionado]?.monto;
          const tolerancia = tenantPlan?.tolerancia ?? 1;
          const nombrePlan = tenantPlan?.nombre ?? PLAN_ID_MAP[planSeleccionado]?.nombre ?? planSeleccionado;
          if (montoEsperado !== undefined && (montoIngresado < montoEsperado - tolerancia || montoIngresado > montoEsperado + tolerancia)) {
            this.conversaciones[jid] = {
              ultimoComando: "MONTO_INCORRECTO", planSeleccionado, flujo, usuarioRenovar,
              hora: Date.now(), esperandoVerificacion: "monto", nombreVerificacion: nombre,
            };
            await this.enviarConDelay(jid, `❌ *El monto no corresponde al plan seleccionado*\n\n📋 Plan: ${nombrePlan}\n💰 Esperado: *Bs ${montoEsperado}*\n💸 Indicaste: Bs ${montoIngresado}\n\nIngresa de nuevo el monto exacto:`);
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
              const mensajeActivacion = this.interpolar(ACTIVACION_EXITOSA({
                usuario: resultado.usuario, contrasena: resultado.contrasena ?? "",
                plan: resultado.plan ?? planInfo.nombre, servidor: resultado.servidor,
              }));
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
        await this.enviarConDelay(jid, `👤 *Usuario:* _${usuarioIngresado}_\n\n${this.generarMenuRenovar()}`);
        return;
      }

      if (textoUpper === "CONSULTAR" || textoUpper === "7") {
        this.conversaciones[jid] = { ultimoComando: "ESPERANDO_USUARIO_CONSULTAR", hora: Date.now(), esperandoUsuarioConsultar: true };
        await this.enviarConDelay(jid, `📅 *Consulta de días restantes*\n\n¿Cuál es tu *nombre de usuario*?\n\n_Escríbelo tal como lo recibiste al activar tu cuenta_`);
        return;
      }

      if (textoUpper === "8" || textoUpper === "SOPORTE") {
        if (this.qrPagoBuffer) {
          this.enviarQRPago(jid).catch(() => {});
        }

        await this.enviarConDelay(jid, `💬 *Solicitud recibida*\n\nHemos notificado al administrador. En breve se comunicará contigo. 🙏`);

        // Obtener número real desde el mapa (populado con remoteJidAlt al recibir el mensaje)
        // Si no está en el mapa, usar el número crudo del JID como último recurso
        const jidResuelto = this.lidAlPhone.get(jid) ?? jid;
        const telefonoParaLink = jidResuelto.split("@")[0];
        console.log(`[PUSHOVER][${this.tenant.id}] JID=${jid} → resuelto=${jidResuelto} → tel=${telefonoParaLink}`);
        this.enviarNotificacionPushover({ titulo: "💬 Solicitud de atención", mensaje: `Cliente +${telefonoParaLink} quiere hablar personalmente en ${this.tenant.nombreEmpresa}.`, telefono: telefonoParaLink }).catch(() => {});
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
          if (resp.tipo === "text") await this.enviarConDelay(jid, this.interpolar(resp.contenido));
          else if (resp.tipo === "video") await this.enviarVideo(jid, resp.contenido, resp.caption ? this.interpolar(resp.caption) : undefined);
          else if (resp.tipo === "image") await this.enviarImagen(jid, resp.contenido, resp.caption ? this.interpolar(resp.caption) : undefined);
        }
        return;
      }

      // ── Saludo y menú principal (dinámico por tenant) ─────────────
      if (textoUpper === "HOLA" || textoUpper === "MENU") {
        await this.enviarConDelay(jid, generarSaludoInicial(this.tenant.nombreEmpresa));
        return;
      }

      // ── Menús de planes por dispositivos (dinámico por tenant) ────
      if (textoUpper === "P" || textoUpper === "Q" || textoUpper === "R") {
        const menu = this.generarMenuPlanesPorLetra(textoUpper as "P" | "Q" | "R");
        await this.enviarConDelay(jid, menu);
        return;
      }

      // ── Selección de plan específico (P1-P4, Q1-Q4, R1-R4) ────────
      if (/^[PQR]\d$/.test(textoUpper) && PLAN_ID_MAP[textoUpper]) {
        const tenantPlan = this.getPlanPorComando(textoUpper);
        const planInfo = PLAN_ID_MAP[textoUpper];
        const nombrePlan = tenantPlan?.nombre ?? planInfo?.nombre ?? textoUpper;
        const montoRegistrar = tenantPlan?.monto ?? planInfo?.monto ?? 0;
        const flujo = estadoAnterior?.flujo ?? "nuevo";
        const usuarioRenovar = estadoAnterior?.usuarioRenovar;

        if (this.veripagos) {
          const confirmacion =
            `✅ *Plan Seleccionado: ${nombrePlan}*\n` +
            `💰 Bs ${montoRegistrar}\n\n` +
            `Generando tu QR de pago exclusivo... 🔄`;
          await this.enviarConDelay(jid, confirmacion);
          this.cancelarPollVeriPagos(jid);
          await this.iniciarPagoVeriPagos(jid, textoUpper, flujo, usuarioRenovar);
        } else {
          const confirmacion = this.generarConfirmacionPlan(textoUpper);
          if (confirmacion) {
            await this.enviarConDelay(jid, confirmacion);
            await this.enviarQRPago(jid);
            this.conversaciones[jid] = {
              ultimoComando: textoUpper, planSeleccionado: textoUpper,
              flujo, usuarioRenovar, hora: Date.now(),
            };
          }
        }
        const telefono = this.extraerTelefono(jid);
        registrarPedido(telefono, textoUpper, montoRegistrar);
        return;
      }

      // ── Respuestas por número/letra ────────────────────────────────
      if (RESPUESTAS_NUMEROS[textoUpper]) {
        const respuestas = RESPUESTAS_NUMEROS[textoUpper];
        for (const resp of respuestas) {
          if (resp.tipo === "text") await this.enviarConDelay(jid, this.interpolar(resp.contenido));
          else if (resp.tipo === "video") await this.enviarVideo(jid, resp.contenido, resp.caption ? this.interpolar(resp.caption) : undefined);
          else if (resp.tipo === "image") await this.enviarImagen(jid, resp.contenido, resp.caption ? this.interpolar(resp.caption) : undefined);
        }

        const PLANES_VALIDOS = new Set(Object.keys(PLAN_ID_MAP));
        const esPlanPagado = PLANES_VALIDOS.has(textoUpper) && !textoUpper.startsWith("DEMO");
        if (esPlanPagado) {
          const flujo = estadoAnterior?.flujo ?? "nuevo";
          const usuarioRenovar = estadoAnterior?.usuarioRenovar;
          if (this.veripagos) {
            this.cancelarPollVeriPagos(jid);
            await this.iniciarPagoVeriPagos(jid, textoUpper, flujo, usuarioRenovar);
          } else {
            await this.enviarQRPago(jid);
            this.conversaciones[jid] = {
              ultimoComando: textoUpper, planSeleccionado: textoUpper,
              flujo, usuarioRenovar, hora: Date.now(),
            };
          }
          const telefono = this.extraerTelefono(jid);
          const planInfo = PLAN_ID_MAP[textoUpper];
          if (planInfo) registrarPedido(telefono, textoUpper, planInfo.monto);
        }
        return;
      }

      // ── Saludos ────────────────────────────────────────────────────
      const esUnSaludo = PALABRAS_SALUDO.some((p) => textoUpper.includes(p));
      if (esUnSaludo) {
        await this.enviarConDelay(jid, generarSaludoInicial(this.tenant.nombreEmpresa));
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
    this.cancelarTodosLosPolls();
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

        // Si el JID es @lid, extraer el número real @s.whatsapp.net directo del mensaje.
        // El objeto msg ya contiene el JID real — lo escaneamos y guardamos en el mapa
        // para que resolverTelefonoReal lo encuentre al construir el enlace wa.me.
        if (remitente.endsWith("@lid")) {
          const msgAny = msg as any;
          const candidatos: unknown[] = [
            msgAny?.key?.remoteJidAlt,
            msgAny?.key?.participantAlt,
            msgAny?.key?.participant,
            msgAny?.participant,
          ];
          let resuelto = false;
          for (const c of candidatos) {
            if (typeof c === "string" && c.endsWith("@s.whatsapp.net")) {
              if (!this.lidAlPhone.has(remitente)) {
                this.lidAlPhone.set(remitente, c);
                this.guardarLidMap();
                const num = c.split("@")[0];
                console.log(`📇 [LID][${this.tenant.id}] Resuelto desde mensaje: ${remitente} → ${c} (tel: ${num})`);
              }
              resuelto = true;
              break;
            }
          }
          if (!resuelto && !this.lidAlPhone.has(remitente)) {
            // Debug: loguear claves del mensaje para identificar el campo correcto
            console.log(`📋 [LID][${this.tenant.id}] Sin resolver: ${remitente} | campos msg.key=${JSON.stringify(Object.keys(msgAny?.key ?? {}))}`);
          }
        }

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

    // Precargar QR de pago en memoria para este tenant
    await this.precargarQR();

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
