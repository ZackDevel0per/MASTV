/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║           SERVICIO GMAIL POR TENANT                                   ║
 * ║  Polling de Gmail configurado por tenant. Cada instancia tiene       ║
 * ║  sus propias credenciales OAuth2 y gestiona sus propios IDs.         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { google, type gmail_v1 } from "googleapis";
import type { TenantConfig } from "./tenant-config.js";
import type { SheetsService } from "./sheets-tenant.js";

const INTERVALO_MS = 30_000;

function extraerTexto(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64").toString("utf-8");
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
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

function extraerDatosPago(texto: string): DatosPago | null {
  const patrones = [
    // "Originante: JUAN PEREZ ... Monto Recibido: Bs 29.00"
    /Originante:\s*([A-ZÁÉÍÓÚÑ ]+?)\s*[\n\r|].*?Monto Recibido:\s*Bs\s*([\d,.]+)/is,
    // "Nombre: JUAN PEREZ ... Monto: 29"
    /Nombre:\s*([^\n\r|]+?)\s*[\n\r|].*?Monto:\s*(?:Bs\.?\s*)?([\d,.]+)/is,
    /nombre:\s*([^\n\r|]+?)\s*[\n\r|].*?monto:\s*(?:Bs\.?\s*)?([\d,.]+)/is,
  ];

  for (const patron of patrones) {
    const match = texto.match(patron);
    if (match) {
      const nombre = match[1]!.trim();
      const montoStr = match[2]!.replace(",", ".");
      const monto = parseFloat(montoStr);
      if (nombre && !isNaN(monto) && monto > 0) {
        return { nombre, monto };
      }
    }
  }

  // Búsqueda simplificada por líneas
  const lineas = texto.split(/[\n\r|]+/);
  let nombre = "";
  let monto = 0;
  for (const linea of lineas) {
    const matchNombre = linea.match(/^(?:Nombre|nombre|Originante):\s*(.+)$/i);
    if (matchNombre) nombre = matchNombre[1]!.trim();

    const matchMonto = linea.match(/^(?:Monto|monto)(?:\s+Recibido)?:\s*(?:Bs\.?\s*)?([\d,.]+)/i);
    if (matchMonto) monto = parseFloat(matchMonto[1]!.replace(",", "."));
  }

  if (nombre && monto > 0) return { nombre, monto };
  return null;
}

/**
 * Servicio de Gmail polling configurado para un tenant específico.
 */
export class GmailService {
  private tenantId: string;
  private clientId: string | null;
  private clientSecret: string | null;
  private refreshToken: string | null;
  private remitenteFiltro: string | null;
  private sheetsService: SheetsService;
  private onPagoDetectado: ((nombre: string, monto: number) => void) | null = null;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private activo = false;
  private idsProcessados = new Set<string>();
  private ultimaRevision: Date | null = null;
  private totalProcesados = 0;
  private errorActual: string | null = null;

  constructor(tenant: TenantConfig, sheetsService: SheetsService) {
    this.tenantId = tenant.id;
    this.clientId = tenant.gmailClientId;
    this.clientSecret = tenant.gmailClientSecret;
    this.refreshToken = tenant.gmailRefreshToken;
    this.remitenteFiltro = tenant.gmailRemitenteFiltro;
    this.sheetsService = sheetsService;
  }

  actualizarConfig(tenant: TenantConfig): void {
    this.clientId = tenant.gmailClientId;
    this.clientSecret = tenant.gmailClientSecret;
    this.refreshToken = tenant.gmailRefreshToken;
    this.remitenteFiltro = tenant.gmailRemitenteFiltro;
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.refreshToken);
  }

  setCallbackPagoDetectado(fn: (nombre: string, monto: number) => void): void {
    this.onPagoDetectado = fn;
  }

  private crearCliente() {
    if (!this.isConfigured()) return null;
    const auth = new google.auth.OAuth2(this.clientId!, this.clientSecret!);
    auth.setCredentials({ refresh_token: this.refreshToken! });
    return google.gmail({ version: "v1", auth });
  }

  async iniciar(): Promise<void> {
    if (!this.isConfigured()) {
      console.log(`ℹ️ [GMAIL][${this.tenantId}] Sin credenciales. Polling desactivado.`);
      return;
    }

    // Cargar IDs ya procesados desde Sheets
    const idsExistentes = await this.sheetsService.obtenerIdsGmailProcesados();
    for (const id of idsExistentes) this.idsProcessados.add(id);

    this.activo = true;
    await this.revisar();

    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.revisar(), INTERVALO_MS);
    console.log(`✅ [GMAIL][${this.tenantId}] Polling iniciado`);
  }

  detener(): void {
    this.activo = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async revisar(): Promise<void> {
    if (!this.activo) return;
    const gmail = this.crearCliente();
    if (!gmail) return;

    try {
      this.ultimaRevision = new Date();
      const query = this.remitenteFiltro ? `from:${this.remitenteFiltro} is:unread` : "is:unread";

      const listRes = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 20 });
      const mensajes = listRes.data.messages ?? [];

      for (const msg of mensajes) {
        if (!msg.id || this.idsProcessados.has(msg.id)) continue;

        const detail = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
        const texto = extraerTexto(detail.data.payload);
        const datos = extraerDatosPago(texto);

        if (datos) {
          await this.sheetsService.registrarPagoEnSheet(msg.id, datos.nombre, datos.monto);
          this.idsProcessados.add(msg.id);
          this.totalProcesados++;

          if (this.onPagoDetectado) {
            this.onPagoDetectado(datos.nombre, datos.monto);
          }

          await gmail.users.messages.modify({
            userId: "me",
            id: msg.id,
            requestBody: { removeLabelIds: ["UNREAD"] },
          });

          console.log(`💰 [GMAIL][${this.tenantId}] Pago detectado: ${datos.nombre} → Bs ${datos.monto}`);
        } else {
          this.idsProcessados.add(msg.id);
        }
      }
      this.errorActual = null;
    } catch (err) {
      this.errorActual = err instanceof Error ? err.message : "Error desconocido";
      console.error(`[GMAIL][${this.tenantId}] Error:`, this.errorActual);
    }
  }

  getEstado() {
    return {
      activo: this.activo,
      configurado: this.isConfigured(),
      ultimaRevision: this.ultimaRevision?.toISOString(),
      totalProcesados: this.totalProcesados,
      error: this.errorActual,
    };
  }
}
