import { google } from "googleapis";

const SPREADSHEET_ID = "1IMij-hFLASRGFmIksZVH6lZLJtILze4ts60xGaqKi8U";
const SHEET_CLIENTES = "Clientes";
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

export interface ClienteData {
  telefono: string;
  titular: string;
  nombreRecibo: string;
}

export interface ClienteRow {
  rowIndex: number;
  telefono: string;
  titular: string;
  nombreRecibo: string;
  estado: string;
}

export interface PagoData {
  telefono: string;
  nombreRecibo: string;
  monto?: string;
  fecha?: string;
}

export async function registrarCliente({ telefono, titular, nombreRecibo }: ClienteData) {
  const sheets = await getSheetsClient();
  const ahora = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CLIENTES}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[telefono, titular, nombreRecibo, "PENDIENTE", ahora]],
    },
  });
}

export async function buscarClientePorRecibo(nombreRecibo: string): Promise<ClienteRow | null> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CLIENTES}!A:E`,
  });

  const rows = res.data.values || [];
  const normalizar = (s: string) => (s || "").toLowerCase().trim();
  const nombre = normalizar(nombreRecibo);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalizar(row[2]) === nombre) {
      return {
        rowIndex: i + 1,
        telefono: row[0],
        titular: row[1],
        nombreRecibo: row[2],
        estado: row[3],
      };
    }
  }
  return null;
}

export async function actualizarEstadoCliente(rowIndex: number, estado: string) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CLIENTES}!D${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[estado]],
    },
  });
}

export async function registrarPago({ telefono, nombreRecibo, monto, fecha }: PagoData) {
  const sheets = await getSheetsClient();
  const ahora = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[telefono, nombreRecibo, monto || "", fecha || ahora, ahora]],
    },
  });
}

export async function inicializarHojas() {
  const sheets = await getSheetsClient();

  const doc = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const hojasTitulos = (doc.data.sheets || []).map((s) => s.properties?.title);
  const requests: object[] = [];

  if (!hojasTitulos.includes(SHEET_CLIENTES)) {
    requests.push({ addSheet: { properties: { title: SHEET_CLIENTES } } });
  }
  if (!hojasTitulos.includes(SHEET_PAGOS)) {
    requests.push({ addSheet: { properties: { title: SHEET_PAGOS } } });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    });
  }

  const clientesRange = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CLIENTES}!A1:E1`,
  });

  if (!clientesRange.data.values || clientesRange.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CLIENTES}!A1:E1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["Teléfono", "Titular", "Nombre Recibo", "Estado", "Fecha Registro"]],
      },
    });
  }

  const pagosRange = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PAGOS}!A1:E1`,
  });

  if (!pagosRange.data.values || pagosRange.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PAGOS}!A1:E1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["Teléfono", "Nombre Recibo", "Monto", "Fecha Pago", "Fecha Registro"]],
      },
    });
  }
}
