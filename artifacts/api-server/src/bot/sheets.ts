import { google } from "googleapis";

const SPREADSHEET_ID = "1IMij-hFLASRGFmIksZVH6lZLJtILze4ts60xGaqKi8U";
const SHEET_PAGOS = "Pagos";

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

/**
 * Inicializa la hoja de Pagos y crea los encabezados si no existen.
 */
export async function inicializarHojas() {
  const sheets = await getSheetsClient();

  const doc = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const hojasTitulos = (doc.data.sheets || []).map((s) => s.properties?.title);

  if (!hojasTitulos.includes(SHEET_PAGOS)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_PAGOS } } }],
      },
    });
  }

  const pagosRange = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!A1:D1`,
  });

  if (!pagosRange.data.values || pagosRange.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PAGOS}!A1:D1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["Fecha", "Nombre", "Monto", "Usado"]],
      },
    });
  }

  console.log("✅ Hoja de Pagos inicializada correctamente");
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
 * Si no lo encuentra, devuelve false.
 *
 * Comparación: nombre en mayúsculas sin espacios extra, monto exacto como número.
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
      // Marcar como Usado = SI
      const rowNumber = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_PAGOS}!D${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["SI"]],
        },
      });
      console.log(`✅ [SHEETS] Pago encontrado y marcado como usado: ${nombre} → Bs ${monto} (fila ${rowNumber})`);
      return true;
    }
  }

  console.warn(`⚠️  [SHEETS] Pago no encontrado: ${nombre} → Bs ${monto}`);
  return false;
}
