/**
 * Almacén en memoria de pagos recibidos via Yape/QR.
 * Tasker registra los pagos aquí; el bot los verifica cuando
 * el cliente escribe VERIFICAR y proporciona su nombre y monto.
 *
 * Cuando Google Sheets esté configurado, este módulo se reemplaza
 * por las funciones equivalentes en sheets.ts.
 */

interface PagoYape {
  nombreOriginal: string; // Tal cual llegó de la notificación (para logs)
  nombreNorm: string;     // Palabras ordenadas alfabéticamente (para comparar)
  monto: number;
  fecha: number;
  usado: boolean;
}

const pagosYape: PagoYape[] = [];

/**
 * Normaliza un nombre para comparación:
 * - Convierte a mayúsculas
 * - Elimina espacios extra
 * - Ordena las palabras alfabéticamente
 *
 * Así "QUIA MIGUEL ANGEL" y "MIGUEL ANGEL QUIA" producen
 * el mismo resultado: "ANGEL MIGUEL QUIA"
 */
function normalizarNombre(nombre: string): string {
  return nombre
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .sort()
    .join(" ");
}

/**
 * Registra un pago recibido desde la notificación de Yape (vía Tasker).
 */
export function registrarPagoYapeLocal(nombre: string, monto: number): void {
  const nombreOriginal = nombre.toUpperCase().trim();
  const nombreNorm = normalizarNombre(nombre);
  const entry: PagoYape = {
    nombreOriginal,
    nombreNorm,
    monto,
    fecha: Date.now(),
    usado: false,
  };
  pagosYape.push(entry);
  console.log(`💾 [YAPE-LOCAL] Pago registrado: "${nombreOriginal}" (normalizado: "${nombreNorm}") → Bs ${monto}`);
  console.log(`📋 [YAPE-LOCAL] Total pagos en memoria: ${pagosYape.length}`);
}

/**
 * Busca un pago no usado con nombre y monto exactos.
 * La comparación de nombre es insensible al orden de las palabras:
 * "QUIA MIGUEL ANGEL" coincide con "MIGUEL ANGEL QUIA".
 * El monto debe ser exactamente igual (sin tolerancia).
 */
export function buscarYUsarPagoLocal(nombre: string, monto: number): boolean {
  const nombreNormBuscado = normalizarNombre(nombre);

  const index = pagosYape.findIndex(
    (p) => !p.usado && p.nombreNorm === nombreNormBuscado && p.monto === monto
  );

  if (index === -1) {
    console.warn(`⚠️  [YAPE-LOCAL] Pago no encontrado: "${nombre.toUpperCase().trim()}" (norm: "${nombreNormBuscado}") → Bs ${monto}`);
    console.warn(
      `📋 [YAPE-LOCAL] Pagos disponibles: ${JSON.stringify(
        pagosYape.map((p) => ({ original: p.nombreOriginal, norm: p.nombreNorm, monto: p.monto, usado: p.usado }))
      )}`
    );
    return false;
  }

  const pago = pagosYape[index]!;
  pago.usado = true;
  console.log(`✅ [YAPE-LOCAL] Pago encontrado: "${pago.nombreOriginal}" coincide con "${nombre.toUpperCase().trim()}" → Bs ${monto}`);
  return true;
}

/** Lista todos los pagos (para debug) */
export function listarPagosYape(): Omit<PagoYape, "nombreNorm">[] {
  return pagosYape.map(({ nombreOriginal, monto, fecha, usado }) => ({
    nombreOriginal,
    monto,
    fecha,
    usado,
  }));
}
