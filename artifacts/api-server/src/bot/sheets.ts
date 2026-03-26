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
// A: Fecha  |  B: Nombre  |  C: Monto  |  D: Usado (SI/NO)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// ESTRUCTURA HOJA "Cuentas":
// A: Teléfono  |  B: Usuario  |  C: Plan  |  D: Fecha  |  E: Estado
// ═══════════════════════════════════════════════════════════════

export interface CuentaRegistrada {
  usuario: string;
  plan: string;
  fecha: string;
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
  if (num.length >= 13 && num.startsWith("1")) {
    num = num.substring(1);
  }
  return num;
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
      range: `${SHEET_CUENTAS}!A:E`,
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
        estado: (row[4] ?? "").toString().trim(),
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

  // Encabezados Pagos
  const pagosRange = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!A1:D1`,
  });
  if (!pagosRange.data.values || pagosRange.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PAGOS}!A1:D1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Fecha", "Nombre", "Monto", "Usado"]] },
    });
  }

  // Encabezados Cuentas
  const cuentasRange = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CUENTAS}!A1:E1`,
  });
  if (!cuentasRange.data.values || cuentasRange.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A1:E1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Teléfono", "Usuario", "Plan", "Fecha", "Estado"]] },
    });
  }

  console.log("✅ Hojas de Google Sheets inicializadas correctamente (Pagos + Cuentas)");
}

/**
 * Registra un pago recibido desde la notificación de Yape (vía Tasker).
 */
export async function registrarPagoYape(nombre: string, monto: number): Promise<void> {
  const sheets = await getSheetsClient();
  const fecha = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!A:D`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[fecha, nombre.toUpperCase().trim(), String(monto), "NO"]],
    },
  });

  console.log(`💾 [SHEETS] Pago registrado: ${nombre} → Bs ${monto}`);
}

/**
 * Busca un pago NO usado con nombre y monto exactos y lo marca como usado.
 */
export async function buscarYUsarPago(nombre: string, monto: number): Promise<boolean> {
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!A:D`,
  });

  const rows = res.data.values || [];
  const normalizar = (s: string) => (s || "").toUpperCase().trim();
  const nombreBuscado = normalizar(nombre);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const nombreFila = normalizar(row[1] ?? "");
    const montoFila = parseFloat(String(row[2] ?? "").replace(",", "."));
    const usado = normalizar(row[3] ?? "");

    if (nombreFila === nombreBuscado && montoFila === monto && usado === "NO") {
      const rowNumber = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_PAGOS}!D${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["SI"]] },
      });
      console.log(`✅ [SHEETS] Pago encontrado y marcado como usado: ${nombre} → Bs ${monto} (fila ${rowNumber})`);
      return true;
    }
  }

  console.warn(`⚠️  [SHEETS] Pago no encontrado: ${nombre} → Bs ${monto}`);
  return false;
}

/**
 * Registra una cuenta nueva en la hoja "Cuentas" y actualiza el caché.
 */
export async function registrarCuenta(
  telefono: string,
  username: string,
  plan: string,
): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const fecha = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
    const telLimpio = limpiarTel(telefono);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A:E`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[telLimpio, username, plan, fecha, "ACTIVA"]],
      },
    });

    // Actualizar caché local sin esperar otro ciclo
    const cuenta: CuentaRegistrada = { usuario: username, plan, fecha, estado: "ACTIVA" };
    const lista = cacheSheets.get(telLimpio) ?? [];
    lista.push(cuenta);
    cacheSheets.set(telLimpio, lista);

    console.log(`💾 [SHEETS] Cuenta registrada: ${telLimpio} → ${username} (${plan})`);
  } catch (err) {
    console.error("[SHEETS] Error al registrar cuenta:", err);
  }
}

/**
 * Actualiza (o crea) la cuenta de un cliente al renovar, y actualiza el caché.
 */
export async function actualizarCuenta(
  telefono: string,
  username: string,
  plan: string,
): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const fecha = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
    const telLimpio = limpiarTel(telefono);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A:E`,
    });

    const rows = res.data.values || [];
    let filaExistente = -1;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const telFila = limpiarTel((row[0] ?? "").toString());
      const userFila = (row[1] ?? "").toString().trim().toLowerCase();
      if (telFila === telLimpio && userFila === username.trim().toLowerCase()) {
        filaExistente = i + 1;
        break;
      }
    }

    if (filaExistente > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CUENTAS}!C${filaExistente}:E${filaExistente}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[plan, fecha, "RENOVADA"]] },
      });
      console.log(`🔄 [SHEETS] Cuenta actualizada (renovada): ${telLimpio} → ${username} (${plan})`);
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CUENTAS}!A:E`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[telLimpio, username, plan, fecha, "RENOVADA"]],
        },
      });
      console.log(`💾 [SHEETS] Cuenta nueva en renovación: ${telLimpio} → ${username} (${plan})`);
    }

    // Actualizar caché local
    const listaCacheActual = cacheSheets.get(telLimpio) ?? [];
    const idx = listaCacheActual.findIndex(
      (c) => c.usuario.toLowerCase() === username.trim().toLowerCase(),
    );
    if (idx >= 0) {
      listaCacheActual[idx] = { usuario: username, plan, fecha, estado: "RENOVADA" };
    } else {
      listaCacheActual.push({ usuario: username, plan, fecha, estado: "RENOVADA" });
    }
    cacheSheets.set(telLimpio, listaCacheActual);
  } catch (err) {
    console.error("[SHEETS] Error al actualizar cuenta:", err);
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
    range: `${SHEET_CUENTAS}!A:E`,
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
        estado: (row[4] ?? "").toString().trim(),
      });
    }
  }

  return cuentas;
}
