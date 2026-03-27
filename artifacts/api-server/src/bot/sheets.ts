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
 * Registra un pago recibido desde la notificación de Yape (vía Tasker).
 */
export async function registrarPagoYape(nombre: string, monto: number): Promise<void> {
  const sheets = await getSheetsClient();
  const fecha = formatearFecha(new Date());

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
