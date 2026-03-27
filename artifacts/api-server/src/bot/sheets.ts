import { google } from "googleapis";

const SPREADSHEET_ID = "1IMij-hFLASRGFmIksZVH6lZLJtILze4ts60xGaqKi8U";
const SHEET_PAGOS = "Pagos";
const SHEET_CUENTAS = "Cuentas";

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no está configurado");
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

// ═══════════════════════════════════════════════════════════════
// ESTRUCTURA HOJA "Pagos":
// A: Fecha  |  B: Nombre  |  C: Monto  |  D: Teléfono  |  E: Fecha Registro  |  F: Estado  |  G: Gmail ID
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// ESTRUCTURA HOJA "Cuentas":
// A: Teléfono  |  B: Usuario  |  C: Plan  |  D: Fecha Creación  |  E: Fecha Expiración  |  F: Estado
// ═══════════════════════════════════════════════════════════════

export interface CuentaRegistrada {
  usuario: string;
  plan: string;
  fecha: string;
  fechaExpiracion: string;
  estado: string;
}

// ── Caché en memoria de la hoja "Cuentas" ────────────────────────────────────
// Mapa: teléfono → lista de cuentas
let cacheSheets: Map<string, CuentaRegistrada[]> = new Map();
let cacheListaMs = 0;
let cacheIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Normaliza un número de teléfono:
 * 1. Elimina todo lo que no sea dígito
 * 2. Elimina el prefijo de enrutamiento "1" que WhatsApp añade a algunos JIDs
 *    (ej: "1591XXXXXXXX" con 13+ dígitos → "591XXXXXXXX")
 */
function limpiarTel(tel: string): string {
  let num = tel.replace(/\D/g, "");
  // Eliminar prefijo de enrutamiento "1" para números ≥ 12 dígitos.
  // Bolivia: 1 + 591XXXXXXXX = 12 dígitos → quitar "1" → 59169741630
  // EE.UU.: 1XXXXXXXXXX = 11 dígitos → NO se quita ("1" es código de país)
  if (num.length >= 12 && num.startsWith("1")) {
    num = num.substring(1);
  }
  return num;
}

/**
 * Formatea una fecha con la misma configuración regional usada en la hoja.
 */
function formatearFecha(fecha: Date): string {
  return fecha.toLocaleString("es-BO", { timeZone: "America/La_Paz" });
}

/**
 * Calcula la fecha de expiración sumando `dias` a la fecha `desde`.
 */
function calcularExpiracion(desde: Date, dias: number): Date {
  const exp = new Date(desde.getTime());
  exp.setDate(exp.getDate() + dias);
  return exp;
}

/**
 * Intenta parsear una fecha almacenada en la hoja (formato es-BO).
 * Retorna null si no puede parsearse.
 */
function parsearFechaHoja(valor: string): Date | null {
  if (!valor) return null;
  // Formato típico es-BO: "27/3/2026, 10:35:00" o "27/03/2026 10:35:00"
  // toLocaleString en es-BO produce algo como: "27/3/2026, 10:35:00 a. m."
  // Intentar parseo directo (funciona en Node con V8)
  const d = new Date(valor);
  if (!isNaN(d.getTime())) return d;

  // Fallback: intentar reordenar DD/MM/YYYY → YYYY-MM-DD para parsearlo
  const match = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const iso = `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
    const d2 = new Date(iso);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

/**
 * Lee TODAS las filas de la hoja "Cuentas" y reconstruye el caché en memoria.
 * Se llama al arranque y luego cada 30 segundos.
 */
async function actualizarCacheSheets(): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
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

    cacheSheets = nuevo;
    cacheListaMs = Date.now();
    console.log(`🔄 [SHEETS] Caché actualizado: ${nuevo.size} números, ${rows.length - 1} filas`);
  } catch (err) {
    console.error("[SHEETS] Error actualizando caché:", err);
  }
}

/**
 * Arranca la carga inicial del caché y programa la actualización cada 30 segundos.
 * Llamar una sola vez al iniciar el servidor.
 */
export function iniciarCacheSheets(): void {
  actualizarCacheSheets();

  if (cacheIntervalId) clearInterval(cacheIntervalId);
  cacheIntervalId = setInterval(() => {
    actualizarCacheSheets();
  }, 30_000);

  console.log("⏱️  [SHEETS] Caché de cuentas activo (actualización cada 30s)");
}

/**
 * Inicializa las hojas de Pagos y Cuentas con sus encabezados si no existen.
 */
export async function inicializarHojas() {
  const sheets = await getSheetsClient();

  const doc = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const hojasTitulos = (doc.data.sheets || []).map((s) => s.properties?.title);

  const hojasACrear: string[] = [];
  if (!hojasTitulos.includes(SHEET_PAGOS)) hojasACrear.push(SHEET_PAGOS);
  if (!hojasTitulos.includes(SHEET_CUENTAS)) hojasACrear.push(SHEET_CUENTAS);

  if (hojasACrear.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: hojasACrear.map((title) => ({
          addSheet: { properties: { title } },
        })),
      },
    });
  }

  // Encabezados Pagos (7 columnas: Fecha | Nombre | Monto | Teléfono | Fecha Registro | Estado | Gmail ID)
  const pagosRange = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!A1:G1`,
  });
  const encabezadosPagos = pagosRange.data.values?.[0] ?? [];
  const ENCABEZADOS_PAGOS = ["Fecha", "Nombre", "Monto", "Teléfono", "Fecha Registro", "Estado", "Gmail ID"];

  if (encabezadosPagos.length === 0) {
    // Hoja nueva: crear con 7 columnas
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PAGOS}!A1:G1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [ENCABEZADOS_PAGOS] },
    });
  } else if (encabezadosPagos.length < 7) {
    // Migración: estructura antigua → 7 columnas
    console.log(`🔧 [SHEETS] Migrando hoja Pagos (${encabezadosPagos.length} cols → 7 cols)...`);
    const datosRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PAGOS}!A:G`,
    });
    const filasPagos = datosRes.data.values ?? [];
    const filasActualizadas = filasPagos.map((fila, idx) => {
      if (idx === 0) return ENCABEZADOS_PAGOS;
      if (encabezadosPagos.length === 4) {
        // 4 cols: Fecha | Nombre | Monto | Usado(SI/NO)
        const estadoViejo = (fila[3] ?? "").toString().toUpperCase().trim();
        const nuevoEstado = estadoViejo === "SI" ? "Usado" : "No usado";
        return [fila[0] ?? "", fila[1] ?? "", fila[2] ?? "", "", "", nuevoEstado, ""];
      } else {
        // 5 cols: Fecha | Nombre | Monto | Estado | Gmail ID
        const estadoViejo = (fila[3] ?? "").toString().trim();
        const nuevoEstado = estadoViejo === "Usado" ? "Usado" : "No usado";
        return [fila[0] ?? "", fila[1] ?? "", fila[2] ?? "", "", "", nuevoEstado, fila[4] ?? ""];
      }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PAGOS}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: filasActualizadas },
    });
    console.log("✅ [SHEETS] Migración Pagos completada.");
  }

  // Encabezados Cuentas (6 columnas)
  // Si ya existe con 5 columnas (estructura anterior), migrar añadiendo "Fecha Expiración"
  const cuentasRange = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CUENTAS}!A1:F1`,
  });
  const encabezadosActuales = cuentasRange.data.values?.[0] ?? [];
  if (encabezadosActuales.length === 0) {
    // Hoja nueva: escribir todos los encabezados
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A1:F1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Teléfono", "Usuario", "Plan", "Fecha Creación", "Fecha Expiración", "Estado"]] },
    });
  } else if (encabezadosActuales.length === 5) {
    // Migración: insertar "Fecha Expiración" como columna E y mover "Estado" a F
    console.log("🔧 [SHEETS] Migrando hoja Cuentas: insertando columna Fecha Expiración...");
    // Leer todos los datos existentes
    const datosRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A:E`,
    });
    const filas = datosRes.data.values ?? [];
    // Insertar columna vacía en posición E (índice 4) en cada fila
    const filasActualizadas = filas.map((fila, idx) => {
      if (idx === 0) {
        // Encabezado
        return ["Teléfono", "Usuario", "Plan", "Fecha Creación", "Fecha Expiración", "Estado"];
      }
      // Insertar cadena vacía como Fecha Expiración, Estado queda en F
      // Prefijo ' en teléfono para forzar formato texto en Sheets
      const telFila = `'${limpiarTel((fila[0] ?? "").toString())}`;
      return [telFila, fila[1] ?? "", fila[2] ?? "", fila[3] ?? "", "", fila[4] ?? ""];
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: filasActualizadas },
    });
    console.log("✅ [SHEETS] Migración completada: columna Fecha Expiración añadida.");
  }

  console.log("✅ Hojas de Google Sheets inicializadas correctamente (Pagos + Cuentas)");
}

/**
 * Compara dos nombres sin importar el orden de las palabras.
 */
function nombresCoinciden(nombreA: string, nombreB: string): boolean {
  const palabrasA = nombreA.toUpperCase().trim().split(/\s+/).sort();
  const palabrasB = nombreB.toUpperCase().trim().split(/\s+/).sort();
  if (palabrasA.length !== palabrasB.length) return false;
  return palabrasA.every((p, i) => p === palabrasB[i]);
}

/**
 * Lee la columna Gmail ID de la hoja Pagos y devuelve un Set con todos los IDs
 * ya registrados. Se usa al arrancar para restaurar la deduplicación.
 */
export async function obtenerIdsGmailProcesados(): Promise<Set<string>> {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PAGOS}!G:G`,
    });
    const ids = new Set<string>();
    const rows = res.data.values ?? [];
    for (let i = 1; i < rows.length; i++) {
      const id = (rows[i]?.[0] ?? "").toString().trim();
      if (id) ids.add(id);
    }
    console.log(`📂 [SHEETS] IDs Gmail ya procesados cargados: ${ids.size}`);
    return ids;
  } catch (err) {
    console.error("[SHEETS] Error cargando IDs Gmail:", err);
    return new Set();
  }
}

/**
 * Registra un pago de Gmail en la hoja Pagos.
 * Es idempotente: si el gmailId ya existe en la hoja, no escribe nada.
 */
export async function registrarPagoEnSheet(
  gmailId: string,
  nombre: string,
  monto: number,
): Promise<void> {
  const sheets = await getSheetsClient();
  const fecha = formatearFecha(new Date());

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!A:G`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[fecha, nombre.toUpperCase().trim(), String(monto), "", "", "No usado", gmailId]],
    },
  });

  console.log(`💾 [SHEETS] Pago registrado: ${nombre} → Bs ${monto} (Gmail ID: ${gmailId})`);
}

export interface ResultadoBusquedaPago {
  encontrado: boolean;
  rowNumber: number;
}

/**
 * Busca un pago "Sin Usar" cuyo nombre y monto coincidan.
 * NO lo marca como usado — llamar a marcarPagoComoUsado() después de confirmar el CRM.
 */
export async function buscarPagoSinUsar(
  nombre: string,
  monto: number,
): Promise<ResultadoBusquedaPago> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
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
    // Estado está en columna F (índice 5) en la nueva estructura
    // Compatibilidad con estructura anterior: Estado en columna D (índice 3)
    const estadoNuevo = (row[5] ?? "").toString().toUpperCase().trim();
    const estadoViejo = (row[3] ?? "").toString().toUpperCase().trim();
    const estadoFila = estadoNuevo || estadoViejo;

    // Acepta todos los formatos: "NO USADO", "SIN USAR", "NO"
    const sinUsar = estadoFila === "NO USADO" || estadoFila === "SIN USAR" || estadoFila === "NO";

    if (
      sinUsar &&
      nombresCoinciden(nombreFila, nombreBuscado) &&
      monto >= montoFila &&
      monto <= montoFila + 1
    ) {
      candidatos.push({ rowNumber: i + 1, montoFila });
    }
  }

  if (candidatos.length === 0) {
    console.warn(`⚠️  [SHEETS] Pago sin usar no encontrado: "${nombreBuscado}" → Bs ${monto}`);
    console.warn(`📋 [SHEETS] Total filas revisadas: ${rows.length - 1}`);
    return { encontrado: false, rowNumber: 0 };
  }

  candidatos.sort((a, b) => b.montoFila - a.montoFila);
  const { rowNumber } = candidatos[0]!;
  console.log(`✅ [SHEETS] Pago encontrado en fila ${rowNumber}: "${nombreBuscado}" → Bs ${monto}`);
  return { encontrado: true, rowNumber };
}

/**
 * Marca una fila de Pagos como "Usado" y registra el teléfono y la fecha de uso.
 * Llamar solo tras confirmar éxito en el CRM.
 * @param rowNumber    Número de fila (1-based) obtenido por buscarPagoSinUsar.
 * @param telefono     Número de teléfono WhatsApp del cliente que verificó el pago.
 * @param fechaRegistro Fecha y hora en que se verificó/usó el comprobante.
 */
export async function marcarPagoComoUsado(
  rowNumber: number,
  telefono: string = "",
  fechaRegistro: string = "",
): Promise<void> {
  const sheets = await getSheetsClient();
  const telLimpio = telefono ? `'${limpiarTel(telefono)}` : "";
  const fecha = fechaRegistro || formatearFecha(new Date());

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!D${rowNumber}:F${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[telLimpio, fecha, "Usado"]] },
  });
  console.log(`✅ [SHEETS] Pago marcado como Usado en fila ${rowNumber} (tel: ${limpiarTel(telefono) || "sin tel"}, fecha: ${fecha})`);
}

/**
 * Registra una cuenta nueva en la hoja "Cuentas" y actualiza el caché.
 * @param diasPlan  Número de días que dura el plan (0 = demo/sin expiración).
 */
export async function registrarCuenta(
  telefono: string,
  username: string,
  plan: string,
  diasPlan: number = 0,
): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const ahora = new Date();
    const fechaCreacion = formatearFecha(ahora);
    const telLimpio = limpiarTel(telefono);

    // Calcular fecha de expiración
    let fechaExpiracion = "";
    if (diasPlan > 0) {
      fechaExpiracion = formatearFecha(calcularExpiracion(ahora, diasPlan));
    }

    // Prefijo ' para forzar que Google Sheets trate el teléfono como texto
    const telParaHoja = `'${telLimpio}`;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A:F`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[telParaHoja, username, plan, fechaCreacion, fechaExpiracion, "ACTIVA"]],
      },
    });

    // Actualizar caché local sin esperar otro ciclo
    const cuenta: CuentaRegistrada = {
      usuario: username,
      plan,
      fecha: fechaCreacion,
      fechaExpiracion,
      estado: "ACTIVA",
    };
    const lista = cacheSheets.get(telLimpio) ?? [];
    lista.push(cuenta);
    cacheSheets.set(telLimpio, lista);

    console.log(`💾 [SHEETS] Cuenta registrada: ${telLimpio} → ${username} (${plan}) exp: ${fechaExpiracion || "sin fecha"}`);
  } catch (err) {
    console.error("[SHEETS] Error al registrar cuenta:", err);
  }
}

/**
 * Actualiza (o crea) la cuenta de un cliente al renovar, y actualiza el caché.
 * La nueva expiración = días restantes actuales + días del nuevo plan.
 * @param diasPlan  Número de días que añade el nuevo plan.
 */
export async function actualizarCuenta(
  telefono: string,
  username: string,
  plan: string,
  diasPlan: number = 0,
): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const ahora = new Date();
    const fechaCreacion = formatearFecha(ahora);
    const telLimpio = limpiarTel(telefono);
    const telParaHoja = `'${telLimpio}`;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
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

    // Calcular nueva fecha de expiración
    let nuevaFechaExpiracion = "";
    if (diasPlan > 0) {
      if (fechaExpiracionActual) {
        const expAnterior = parsearFechaHoja(fechaExpiracionActual);
        if (expAnterior && expAnterior > ahora) {
          // Quedan días: nueva exp = expiración actual + días del plan
          nuevaFechaExpiracion = formatearFecha(calcularExpiracion(expAnterior, diasPlan));
          const diasRestantes = Math.ceil((expAnterior.getTime() - ahora.getTime()) / 86_400_000);
          console.log(`📅 [SHEETS] Renovación con ${diasRestantes} días restantes → +${diasPlan} días`);
        } else {
          // Ya expiró: nueva exp = hoy + días del plan
          nuevaFechaExpiracion = formatearFecha(calcularExpiracion(ahora, diasPlan));
        }
      } else {
        // No había expiración previa
        nuevaFechaExpiracion = formatearFecha(calcularExpiracion(ahora, diasPlan));
      }
    }

    if (filaExistente > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CUENTAS}!C${filaExistente}:F${filaExistente}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[plan, fechaCreacion, nuevaFechaExpiracion, "RENOVADA"]] },
      });
      console.log(`🔄 [SHEETS] Cuenta renovada: ${telLimpio} → ${username} (${plan}) exp: ${nuevaFechaExpiracion || "sin fecha"}`);
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CUENTAS}!A:F`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[telParaHoja, username, plan, fechaCreacion, nuevaFechaExpiracion, "RENOVADA"]],
        },
      });
      console.log(`💾 [SHEETS] Cuenta nueva en renovación: ${telLimpio} → ${username} (${plan}) exp: ${nuevaFechaExpiracion || "sin fecha"}`);
    }

    // Actualizar caché local
    const listaCacheActual = cacheSheets.get(telLimpio) ?? [];
    const idx = listaCacheActual.findIndex(
      (c) => c.usuario.toLowerCase() === username.trim().toLowerCase(),
    );
    const cuentaActualizada: CuentaRegistrada = {
      usuario: username,
      plan,
      fecha: fechaCreacion,
      fechaExpiracion: nuevaFechaExpiracion,
      estado: "RENOVADA",
    };
    if (idx >= 0) {
      listaCacheActual[idx] = cuentaActualizada;
    } else {
      listaCacheActual.push(cuentaActualizada);
    }
    cacheSheets.set(telLimpio, listaCacheActual);
  } catch (err) {
    console.error("[SHEETS] Error al actualizar cuenta:", err);
  }
}

/**
 * Busca en la hoja "Cuentas" todas las filas donde el teléfono sea `lidNumero`
 * y las reemplaza por `telefonoReal`. Útil cuando contacts.upsert resuelve
 * un @lid al número de teléfono real después de que ya se registraron datos.
 * Retorna la cantidad de filas actualizadas.
 */
export async function actualizarTelefonoPorLid(
  lidNumero: string,
  telefonoReal: string,
): Promise<number> {
  const lidLimpio = limpiarTel(lidNumero);
  const telLimpio = limpiarTel(telefonoReal);
  if (!lidLimpio || !telLimpio || lidLimpio === telLimpio) return 0;

  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
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
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: actualizaciones.map((a) => ({
          range: a.range,
          values: [[a.value]],
        })),
      },
    });

    // Actualizar caché: mover entradas del LID al teléfono real
    const entradasLid = cacheSheets.get(lidLimpio) ?? [];
    if (entradasLid.length > 0) {
      const entradasExistentes = cacheSheets.get(telLimpio) ?? [];
      cacheSheets.set(telLimpio, [...entradasExistentes, ...entradasLid]);
      cacheSheets.delete(lidLimpio);
    }

    console.log(`🔄 [SHEETS] Teléfono actualizado de LID ${lidLimpio} → ${telLimpio} (${actualizaciones.length} fila${actualizaciones.length === 1 ? "" : "s"})`);
    return actualizaciones.length;
  } catch (err) {
    console.error("[SHEETS] Error al actualizar teléfono por LID:", err);
    return 0;
  }
}

/**
 * Busca cuentas por teléfono usando el caché en memoria (no hace llamadas a la API).
 * Si el caché está vacío (p.ej. antes del primer ciclo), hace una consulta directa.
 */
export async function buscarCuentasPorTelefono(telefono: string): Promise<CuentaRegistrada[]> {
  const telLimpio = limpiarTel(telefono);

  // Si el caché ya fue cargado, usarlo directamente
  if (cacheListaMs > 0) {
    return cacheSheets.get(telLimpio) ?? [];
  }

  // Caché aún no disponible: consulta directa (solo en arranque)
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
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
