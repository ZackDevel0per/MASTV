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
 * Agrega una fila nueva: fecha, nombre del pagador, monto, Usado=NO
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
 * Busca un pago NO usado con nombre y monto exactos.
 * Si lo encuentra, lo marca como Usado=SI y devuelve true.
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
 * Registra una cuenta nueva en la hoja "Cuentas".
 * Se llama cuando el bot crea una cuenta nueva exitosamente.
 */
export async function registrarCuenta(
  telefono: string,
  username: string,
  plan: string,
): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const fecha = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
    const telLimpio = telefono.replace(/\D/g, "");

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A:E`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[telLimpio, username, plan, fecha, "ACTIVA"]],
      },
    });

    console.log(`💾 [SHEETS] Cuenta registrada: ${telLimpio} → ${username} (${plan})`);
  } catch (err) {
    console.error("[SHEETS] Error al registrar cuenta:", err);
  }
}

/**
 * Actualiza la cuenta existente de un teléfono+usuario en la hoja "Cuentas"
 * cuando se renueva. Si no existe la fila, la agrega como nueva.
 */
export async function actualizarCuenta(
  telefono: string,
  username: string,
  plan: string,
): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const fecha = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
    const telLimpio = telefono.replace(/\D/g, "");

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CUENTAS}!A:E`,
    });

    const rows = res.data.values || [];
    let filaExistente = -1;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const telFila = (row[0] ?? "").toString().replace(/\D/g, "");
      const userFila = (row[1] ?? "").toString().trim().toLowerCase();
      if (telFila === telLimpio && userFila === username.trim().toLowerCase()) {
        filaExistente = i + 1; // 1-indexed para Sheets
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
      console.log(`💾 [SHEETS] Cuenta nueva registrada en renovación: ${telLimpio} → ${username} (${plan})`);
    }
  } catch (err) {
    console.error("[SHEETS] Error al actualizar cuenta:", err);
  }
}

/**
 * Busca todas las cuentas registradas para un número de teléfono.
 * Retorna array vacío si no hay cuentas o si Sheets no está configurado.
 */
export async function buscarCuentasPorTelefono(telefono: string): Promise<CuentaRegistrada[]> {
  const telLimpio = telefono.replace(/\D/g, "");

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
    const telFila = (row[0] ?? "").toString().replace(/\D/g, "");
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
