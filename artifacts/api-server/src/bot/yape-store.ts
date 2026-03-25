/**
 * Almacén en memoria de pagos recibidos via Yape/QR.
 * Tasker registra los pagos aquí; el bot los verifica cuando
 * el cliente escribe VERIFICAR y proporciona su nombre y monto.
 *
 * Cuando Google Sheets esté configurado, este módulo se reemplaza
 * por las funciones equivalentes en sheets.ts.
 */

interface PagoYape {
  nombre: string;   // En mayúsculas, sin espacios extra
  monto: number;    // Exacto, sin tolerancia
  fecha: number;    // Timestamp
  usado: boolean;
}

const pagosYape: PagoYape[] = [];

/**
 * Registra un pago recibido desde la notificación de Yape (vía Tasker).
 */
export function registrarPagoYapeLocal(nombre: string, monto: number): void {
  const entry: PagoYape = {
    nombre: nombre.toUpperCase().trim(),
    monto,
    fecha: Date.now(),
    usado: false,
  };
  pagosYape.push(entry);
  console.log(`💾 [YAPE-LOCAL] Pago registrado: ${entry.nombre} → Bs ${monto}`);
  console.log(`📋 [YAPE-LOCAL] Total pagos en memoria: ${pagosYape.length}`);
}

/**
 * Compara dos nombres sin importar el orden de las palabras.
 * Todas las palabras deben estar presentes en ambos nombres.
 */
function nombresCoinciden(nombreA: string, nombreB: string): boolean {
  const palabrasA = nombreA.toUpperCase().trim().split(/\s+/).sort();
  const palabrasB = nombreB.toUpperCase().trim().split(/\s+/).sort();
  if (palabrasA.length !== palabrasB.length) return false;
  return palabrasA.every((p, i) => p === palabrasB[i]);
}

/**
 * Busca un pago no usado cuyo nombre coincida y cuyo monto esté dentro del
 * rango [planMonto, planMonto + 1]. Devuelve el índice del pago encontrado
 * o -1 si no hay coincidencia. NO lo marca como usado.
 * Usar junto a marcarPagoUsado() una vez confirmado el CRM.
 */
export function encontrarIndexPago(nombre: string, monto: number): number {
  const nombreBuscado = nombre.toUpperCase().trim();

  const candidatos = pagosYape
    .map((p, i) => ({ p, i }))
    .filter(({ p }) =>
      !p.usado &&
      nombresCoinciden(p.nombre, nombreBuscado) &&
      monto >= p.monto &&
      monto <= p.monto + 1
    );

  if (candidatos.length === 0) {
    console.warn(`⚠️  [YAPE-LOCAL] Pago no encontrado: "${nombreBuscado}" → Bs ${monto}`);
    console.warn(`📋 [YAPE-LOCAL] Pagos disponibles: ${JSON.stringify(pagosYape.map(p => ({ nombre: p.nombre, monto: p.monto, usado: p.usado })))}`);
    return -1;
  }

  // Preferir el de mayor monto de plan (más cercano al pagado)
  candidatos.sort((a, b) => b.p.monto - a.p.monto);
  return candidatos[0]!.i;
}

/**
 * Marca como usado un pago por su índice (obtenido con encontrarIndexPago).
 * Llamar solo después de confirmar que el CRM procesó el plan correctamente.
 */
export function marcarPagoUsado(index: number): void {
  const p = pagosYape[index];
  if (!p) return;
  p.usado = true;
  console.log(`✅ [YAPE-LOCAL] Pago marcado como usado: "${p.nombre}" → Bs ${p.monto}`);
}

/** @deprecated Usar encontrarIndexPago + marcarPagoUsado para evitar consumir el pago si el CRM falla */
export function buscarYUsarPagoLocal(nombre: string, monto: number): boolean {
  const index = encontrarIndexPago(nombre, monto);
  if (index === -1) return false;
  marcarPagoUsado(index);
  return true;
}

/** Lista todos los pagos (para debug) */
export function listarPagosYape(): PagoYape[] {
  return [...pagosYape];
}
