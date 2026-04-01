/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║          SERVICIO DE GOOGLE SHEETS POR TENANT                        ║
 * ║  Wrapper tenant-aware de sheets.ts. Cada instancia usa el            ║
 * ║  spreadsheetId y service account del tenant correspondiente.         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { google } from "googleapis";
import type { TenantConfig } from "./tenant-config.js";
import { db } from "@workspace/db";
import { tenantPagosTable, tenantCuentasTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SHEET_PAGOS = "Pagos";
const SHEET_CUENTAS = "Cuentas";

export interface CuentaRegistrada {
  usuario: string;
  plan: string;
  fecha: string;
  fechaExpiracion: string;
  estado: string;
}

export interface ResultadoBusquedaPago {
  encontrado: boolean;
  rowNumber: number;
}

function limpiarTel(tel: string): string {
  let num = tel.replace(/\D/g, "");
  if (num.length >= 12 && num.startsWith("1")) num = num.substring(1);
  return num;
}

function formatearFecha(fecha: Date): string {
  return fecha.toLocaleString("es-BO", { timeZone: "America/La_Paz" });
}

function calcularExpiracion(desde: Date, dias: number): Date {
  const exp = new Date(desde.getTime());
  exp.setDate(exp.getDate() + dias);
  return exp;
}

function parsearFechaHoja(valor: string): Date | null {
  if (!valor) return null;
  const d = new Date(valor);
  if (!isNaN(d.getTime())) return d;
  const match = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const iso = `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
    const d2 = new Date(iso);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

function nombresCoinciden(nombreA: string, nombreB: string): boolean {
  const palabrasA = nombreA.toUpperCase().trim().split(/\s+/).sort();
  const palabrasB = nombreB.toUpperCase().trim().split(/\s+/).sort();
  if (palabrasA.length !== palabrasB.length) return false;
  return palabrasA.every((p, i) => p === palabrasB[i]);
}

/**
 * Servicio de Sheets configurado para un tenant específico.
 */
export class SheetsService {
  private spreadsheetId: string;
  private serviceAccountJson: string;
  private tenantId: string;
  private cacheSheets: Map<string, CuentaRegistrada[]> = new Map();
  private cacheListaMs = 0;
  private cacheIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(tenant: TenantConfig) {
    this.spreadsheetId = tenant.spreadsheetId ?? "";
    this.serviceAccountJson = tenant.googleServiceAccountJson ?? "";
    this.tenantId = tenant.id;
  }

  actualizarConfig(tenant: TenantConfig): void {
    this.spreadsheetId = tenant.spreadsheetId ?? "";
    this.serviceAccountJson = tenant.googleServiceAccountJson ?? "";
    this.cacheSheets.clear();
    this.cacheListaMs = 0;
  }

  isConfigured(): boolean {
    return !!(this.spreadsheetId && this.serviceAccountJson);
  }

  private getAuth() {
    if (!this.serviceAccountJson) throw new Error(`[${this.tenantId}] GOOGLE_SERVICE_ACCOUNT_JSON no configurado`);
    const credentials = JSON.parse(this.serviceAccountJson);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }

  private async getClient() {
    const auth = this.getAuth();
    return google.sheets({ version: "v4", auth });
  }

  async inicializarHojas(): Promise<void> {
    if (!this.isConfigured()) return;
    const sheets = await this.getClient();
    const doc = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const hojasTitulos = (doc.data.sheets || []).map((s) => s.properties?.title);

    const hojasACrear: string[] = [];
    if (!hojasTitulos.includes(SHEET_PAGOS)) hojasACrear.push(SHEET_PAGOS);
    if (!hojasTitulos.includes(SHEET_CUENTAS)) hojasACrear.push(SHEET_CUENTAS);

    if (hojasACrear.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: hojasACrear.map((title) => ({ addSheet: { properties: { title } } })) },
      });
    }

    // Encabezados Pagos
    const pagosRange = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_PAGOS}!A1:G1`,
    });
    if ((pagosRange.data.values?.[0] ?? []).length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_PAGOS}!A1:G1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Fecha", "Nombre", "Monto", "Teléfono", "Fecha Registro", "Estado", "Gmail ID"]] },
      });
    }

    // Encabezados Cuentas
    const cuentasRange = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_CUENTAS}!A1:F1`,
    });
    if ((cuentasRange.data.values?.[0] ?? []).length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_CUENTAS}!A1:F1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Teléfono", "Usuario", "Plan", "Fecha Creación", "Fecha Expiración", "Estado"]] },
      });
    }

    console.log(`✅ [SHEETS][${this.tenantId}] Hojas inicializadas`);
  }

  private async actualizarCache(): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      const sheets = await this.getClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_CUENTAS}!A:F`,
      });

      const rows = res.data.values || [];
      const nuevo: Map<string, CuentaRegistrada[]> = new Map();

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const tel = limpiarTel((row[0] ?? "").toString());
        if (!tel) continue;
        const cuenta: CuentaRegistrada = {
          usuario: (row[1] ?? "").toString().trim(),
          plan: (row[2] ?? "").toString().trim(),
          fecha: (row[3] ?? "").toString().trim(),
          fechaExpiracion: (row[4] ?? "").toString().trim(),
          estado: (row[5] ?? "").toString().trim(),
        };
        const lista = nuevo.get(tel) ?? [];
        lista.push(cuenta);
        nuevo.set(tel, lista);
      }

      this.cacheSheets = nuevo;
      this.cacheListaMs = Date.now();
      console.log(`🔄 [SHEETS][${this.tenantId}] Caché: ${nuevo.size} números, ${rows.length - 1} filas`);

      // Sincronizar con DB central para auditoría
      await this.sincronizarCuentasConDB(rows);
    } catch (err) {
      console.error(`[SHEETS][${this.tenantId}] Error actualizando caché:`, err);
    }
  }

  private async sincronizarCuentasConDB(rows: string[][]): Promise<void> {
    try {
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const usuario = (row[1] ?? "").toString().trim();
        if (!usuario) continue;

        await db
          .insert(tenantCuentasTable)
          .values({
            tenantId: this.tenantId,
            telefono: limpiarTel((row[0] ?? "").toString()),
            usuario,
            plan: (row[2] ?? "").toString().trim(),
            fechaCreacion: (row[3] ?? "").toString().trim(),
            fechaExpiracion: (row[4] ?? "").toString().trim(),
            estado: (row[5] ?? "").toString().trim() || "ACTIVA",
          })
          .onConflictDoNothing()
          .catch(() => {});
      }
    } catch {
      // No bloquear si DB falla
    }
  }

  iniciarCache(): void {
    this.actualizarCache();
    if (this.cacheIntervalId) clearInterval(this.cacheIntervalId);
    this.cacheIntervalId = setInterval(() => this.actualizarCache(), 30_000);
    console.log(`⏱️ [SHEETS][${this.tenantId}] Caché activo`);
  }

  detenerCache(): void {
    if (this.cacheIntervalId) {
      clearInterval(this.cacheIntervalId);
      this.cacheIntervalId = null;
    }
  }

  async obtenerIdsGmailProcesados(): Promise<Set<string>> {
    if (!this.isConfigured()) return new Set();
    try {
      const sheets = await this.getClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_PAGOS}!G:G`,
      });
      const ids = new Set<string>();
      for (let i = 1; i < (res.data.values ?? []).length; i++) {
        const id = ((res.data.values ?? [])[i]?.[0] ?? "").toString().trim();
        if (id) ids.add(id);
      }
      return ids;
    } catch {
      return new Set();
    }
  }

  async registrarPagoEnSheet(gmailId: string, nombre: string, monto: number): Promise<void> {
    if (!this.isConfigured()) return;
    const sheets = await this.getClient();
    const fecha = formatearFecha(new Date());
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_PAGOS}!A:G`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[fecha, nombre.toUpperCase().trim(), String(monto), "", "", "No usado", gmailId]] },
    });
    console.log(`💾 [SHEETS][${this.tenantId}] Pago: ${nombre} → Bs ${monto}`);

    // Sincronizar con DB central
    await db.insert(tenantPagosTable).values({
      tenantId: this.tenantId,
      fecha,
      nombre: nombre.toUpperCase().trim(),
      monto,
      estado: "No usado",
      gmailId,
    }).onConflictDoNothing().catch(() => {});
  }

  async buscarPagoSinUsar(nombre: string, monto: number): Promise<ResultadoBusquedaPago> {
    if (!this.isConfigured()) return { encontrado: false, rowNumber: 0 };
    const sheets = await this.getClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_PAGOS}!A:G`,
    });

    const rows = res.data.values ?? [];
    const nombreBuscado = nombre.toUpperCase().trim();
    const candidatos: Array<{ rowNumber: number; montoFila: number }> = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const nombreFila = (row[1] ?? "").toString().toUpperCase().trim();
      const montoFila = parseFloat((row[2] ?? "0").toString().replace(",", "."));
      const estadoNuevo = (row[5] ?? "").toString().toUpperCase().trim();
      const estadoViejo = (row[3] ?? "").toString().toUpperCase().trim();
      const estadoFila = estadoNuevo || estadoViejo;
      const sinUsar = estadoFila === "NO USADO" || estadoFila === "SIN USAR" || estadoFila === "NO";

      if (sinUsar && nombresCoinciden(nombreFila, nombreBuscado) && monto >= montoFila && monto <= montoFila + 1) {
        candidatos.push({ rowNumber: i + 1, montoFila });
      }
    }

    if (candidatos.length === 0) return { encontrado: false, rowNumber: 0 };
    candidatos.sort((a, b) => b.montoFila - a.montoFila);
    return { encontrado: true, rowNumber: candidatos[0]!.rowNumber };
  }

  async marcarPagoComoUsado(rowNumber: number, telefono: string = "", fechaRegistro: string = ""): Promise<void> {
    if (!this.isConfigured()) return;
    const sheets = await this.getClient();
    const telLimpio = telefono ? `'${limpiarTel(telefono)}` : "";
    const fecha = fechaRegistro || formatearFecha(new Date());
    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_PAGOS}!D${rowNumber}:F${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[telLimpio, fecha, "Usado"]] },
    });
  }

  async registrarCuenta(telefono: string, username: string, plan: string, diasPlan: number = 0): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      const sheets = await this.getClient();
      const ahora = new Date();
      const fechaCreacion = formatearFecha(ahora);
      const telLimpio = limpiarTel(telefono);
      const fechaExpiracion = diasPlan > 0 ? formatearFecha(calcularExpiracion(ahora, diasPlan)) : "";
      const telParaHoja = `'${telLimpio}`;

      await sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_CUENTAS}!A:F`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[telParaHoja, username, plan, fechaCreacion, fechaExpiracion, "ACTIVA"]] },
      });

      const cuenta: CuentaRegistrada = { usuario: username, plan, fecha: fechaCreacion, fechaExpiracion, estado: "ACTIVA" };
      const lista = this.cacheSheets.get(telLimpio) ?? [];
      lista.push(cuenta);
      this.cacheSheets.set(telLimpio, lista);

      // Sync DB
      await db.insert(tenantCuentasTable).values({
        tenantId: this.tenantId, telefono: telLimpio, usuario: username, plan,
        fechaCreacion, fechaExpiracion, estado: "ACTIVA",
      }).onConflictDoNothing().catch(() => {});
    } catch (err) {
      console.error(`[SHEETS][${this.tenantId}] Error registrando cuenta:`, err);
    }
  }

  async actualizarCuenta(telefono: string, username: string, plan: string, diasPlan: number = 0): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      const sheets = await this.getClient();
      const ahora = new Date();
      const fechaCreacion = formatearFecha(ahora);
      const telLimpio = limpiarTel(telefono);
      const telParaHoja = `'${telLimpio}`;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_CUENTAS}!A:F`,
      });
      const rows = res.data.values || [];
      let filaExistente = -1;
      let fechaExpiracionActual = "";

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const telFila = limpiarTel((row[0] ?? "").toString());
        const userFila = (row[1] ?? "").toString().trim().toLowerCase();
        if (telFila === telLimpio && userFila === username.trim().toLowerCase()) {
          filaExistente = i + 1;
          fechaExpiracionActual = (row[4] ?? "").toString().trim();
          break;
        }
      }

      let nuevaFechaExpiracion = "";
      if (diasPlan > 0) {
        if (fechaExpiracionActual) {
          const expAnterior = parsearFechaHoja(fechaExpiracionActual);
          if (expAnterior && expAnterior > ahora) {
            nuevaFechaExpiracion = formatearFecha(calcularExpiracion(expAnterior, diasPlan));
          } else {
            nuevaFechaExpiracion = formatearFecha(calcularExpiracion(ahora, diasPlan));
          }
        } else {
          nuevaFechaExpiracion = formatearFecha(calcularExpiracion(ahora, diasPlan));
        }
      }

      if (filaExistente > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${SHEET_CUENTAS}!C${filaExistente}:F${filaExistente}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[plan, fechaCreacion, nuevaFechaExpiracion, "RENOVADA"]] },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `${SHEET_CUENTAS}!A:F`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[telParaHoja, username, plan, fechaCreacion, nuevaFechaExpiracion, "RENOVADA"]] },
        });
      }

      const listaCacheActual = this.cacheSheets.get(telLimpio) ?? [];
      const idx = listaCacheActual.findIndex((c) => c.usuario.toLowerCase() === username.trim().toLowerCase());
      const cuentaActualizada: CuentaRegistrada = { usuario: username, plan, fecha: fechaCreacion, fechaExpiracion: nuevaFechaExpiracion, estado: "RENOVADA" };
      if (idx >= 0) listaCacheActual[idx] = cuentaActualizada;
      else listaCacheActual.push(cuentaActualizada);
      this.cacheSheets.set(telLimpio, listaCacheActual);
    } catch (err) {
      console.error(`[SHEETS][${this.tenantId}] Error actualizando cuenta:`, err);
    }
  }

  async sincronizarLineasCRM(lineas: Array<{
    username: string;
    planNombre: string;
    fechaCreacion: string;
    fechaExpiracion: string;
    expDateMs?: number;
    estado: string;
  }>): Promise<{ total: number; nuevas: number; actualizadas: number; errores: number }> {
    if (!this.isConfigured()) return { total: lineas.length, nuevas: 0, actualizadas: 0, errores: 0 };
    const sheets = await this.getClient();

    // Leer toda la hoja actual para preservar teléfonos (col A) registrados por el bot
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_CUENTAS}!A:F`,
    });
    const filasActuales = res.data.values ?? [];

    // Mapa: username.toLowerCase() → teléfono guardado en col A
    const telefonoPorUsuario = new Map<string, string>();
    for (let i = 1; i < filasActuales.length; i++) {
      const tel = (filasActuales[i]?.[0] ?? "").toString().trim();
      const user = (filasActuales[i]?.[1] ?? "").toString().toLowerCase().trim();
      if (user) telefonoPorUsuario.set(user, tel);
    }

    const prevTotal = Math.max(filasActuales.length - 1, 0);

    // Ordenar: fecha de expiración más próxima primero, sin fecha al final
    const lineasOrdenadas = [...lineas].sort((a, b) => {
      const msA = a.expDateMs ?? 0;
      const msB = b.expDateMs ?? 0;
      if (msA === 0 && msB === 0) return 0;
      if (msA === 0) return 1;
      if (msB === 0) return -1;
      return msA - msB;
    });

    // Construir filas completas con el teléfono preservado
    const filasNuevas: string[][] = lineasOrdenadas.map((l) => {
      const tel = telefonoPorUsuario.get(l.username.toLowerCase().trim()) ?? "";
      return [tel, l.username, l.planNombre, l.fechaCreacion, l.fechaExpiracion, l.estado];
    });

    let errores = 0;
    try {
      // Limpiar todos los datos (desde fila 2 en adelante)
      if (prevTotal > 0) {
        await sheets.spreadsheets.values.clear({
          spreadsheetId: this.spreadsheetId,
          range: `${SHEET_CUENTAS}!A2:F`,
        });
      }

      // Escribir todas las filas ordenadas de una vez
      if (filasNuevas.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${SHEET_CUENTAS}!A2`,
          valueInputOption: "RAW",
          requestBody: { values: filasNuevas },
        });
      }

      this.cacheListaMs = 0;
    } catch (err) {
      console.error(`[SHEETS][${this.tenantId}] Error en sync CRM:`, err);
      errores = lineasOrdenadas.length;
    }

    const nuevas = Math.max(lineasOrdenadas.length - prevTotal, 0);
    const actualizadas = lineasOrdenadas.length - nuevas;
    const resultado = { total: lineas.length, nuevas, actualizadas, errores };
    console.log(`🔄 [SHEETS][${this.tenantId}] Sync CRM→Sheets: ${resultado.nuevas} nuevas, ${resultado.actualizadas} actualizadas, ${resultado.errores} errores`);
    return resultado;
  }

  async actualizarTelefonoPorLid(lidNumero: string, telefonoReal: string): Promise<number> {
    if (!this.isConfigured()) return 0;
    const lidLimpio = limpiarTel(lidNumero);
    const telLimpio = limpiarTel(telefonoReal);
    if (!lidLimpio || !telLimpio || lidLimpio === telLimpio) return 0;
    try {
      const sheets = await this.getClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_CUENTAS}!A:F`,
      });
      const rows = res.data.values || [];
      const actualizaciones: { range: string; value: string }[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const telFila = limpiarTel((row[0] ?? "").toString());
        if (telFila === lidLimpio) {
          actualizaciones.push({ range: `${SHEET_CUENTAS}!A${i + 1}`, value: `'${telLimpio}` });
        }
      }
      if (actualizaciones.length === 0) return 0;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: actualizaciones.map((a) => ({ range: a.range, values: [[a.value]] })),
        },
      });
      const entradasLid = this.cacheSheets.get(lidLimpio) ?? [];
      if (entradasLid.length > 0) {
        const entradasExistentes = this.cacheSheets.get(telLimpio) ?? [];
        this.cacheSheets.set(telLimpio, [...entradasExistentes, ...entradasLid]);
        this.cacheSheets.delete(lidLimpio);
      }
      return actualizaciones.length;
    } catch {
      return 0;
    }
  }

  async buscarCuentasPorTelefono(telefono: string): Promise<CuentaRegistrada[]> {
    const telLimpio = limpiarTel(telefono);
    if (this.cacheListaMs > 0) return this.cacheSheets.get(telLimpio) ?? [];
    if (!this.isConfigured()) return [];
    const sheets = await this.getClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_CUENTAS}!A:F`,
    });
    const rows = res.data.values || [];
    const cuentas: CuentaRegistrada[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const telFila = limpiarTel((row[0] ?? "").toString());
      if (telFila === telLimpio) {
        cuentas.push({
          usuario: (row[1] ?? "").toString().trim(),
          plan: (row[2] ?? "").toString().trim(),
          fecha: (row[3] ?? "").toString().trim(),
          fechaExpiracion: (row[4] ?? "").toString().trim(),
          estado: (row[5] ?? "").toString().trim(),
        });
      }
    }
    return cuentas;
  }

  async obtenerSiguienteUsername(prefix: string): Promise<string> {
    const usuariosEnUso = new Set<string>();
    if (this.cacheListaMs > 0) {
      for (const cuentas of this.cacheSheets.values()) {
        for (const c of cuentas) {
          if (c.usuario) usuariosEnUso.add(c.usuario.toLowerCase().trim());
        }
      }
    } else if (this.isConfigured()) {
      try {
        const sheets = await this.getClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `${SHEET_CUENTAS}!B:B`,
        });
        for (let i = 1; i < (res.data.values ?? []).length; i++) {
          const usuario = ((res.data.values ?? [])[i]?.[0] ?? "").toString().toLowerCase().trim();
          if (usuario) usuariosEnUso.add(usuario);
        }
      } catch { /* ignorar */ }
    }

    for (let n = 1; n <= 99999; n++) {
      const candidato = `${prefix}${String(n).padStart(5, "0")}`;
      if (!usuariosEnUso.has(candidato)) return candidato;
    }
    throw new Error(`No hay usernames disponibles con prefijo "${prefix}"`);
  }
}
