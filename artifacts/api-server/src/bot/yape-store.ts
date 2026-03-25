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
 * rango [montoRecibido - 1, montoRecibido]. Es decir, el cliente puede haber
 * depositado hasta 1 Bs más que el precio del plan y aún así se le valida.
 * Si hay varios candidatos, se elige el de mayor monto de plan (el más cercano).
 */
export function buscarYUsarPagoLocal(nombre: string, monto: number): boolean {
  const nombreBuscado = nombre.toUpperCase().trim();

  // Recoger todos los candidatos que coinciden en nombre y están dentro del margen
  const candidatos = pagosYape
    .map((p, i) => ({ p, i }))
    .filter(({ p }) =>
      !p.usado &&
      nombresCoinciden(p.nombre, nombreBuscado) &&
      monto >= p.monto &&        // el cliente no pagó menos que el plan
      monto <= p.monto + 1       // el cliente pagó a lo sumo 1 Bs más
    );

  if (candidatos.length === 0) {
    console.warn(`⚠️  [YAPE-LOCAL] Pago no encontrado: "${nombreBuscado}" → Bs ${monto}`);
    console.warn(`📋 [YAPE-LOCAL] Pagos disponibles: ${JSON.stringify(pagosYape.map(p => ({ nombre: p.nombre, monto: p.monto, usado: p.usado })))}`);
    return false;
  }

  // Si hay más de uno, preferir el de mayor monto de plan (más cercano al pagado)
  candidatos.sort((a, b) => b.p.monto - a.p.monto);
  const { p, i } = candidatos[0]!;
  pagosYape[i]!.usado = true;
  console.log(
    `✅ [YAPE-LOCAL] Pago encontrado y marcado como usado: "${nombreBuscado}" → ` +
    `pagado Bs ${monto} / plan Bs ${p.monto}${monto !== p.monto ? ` (diferencia +${(monto - p.monto).toFixed(2)})` : ""}`
  );
  return true;
}

/** Lista todos los pagos (para debug) */
export function listarPagosYape(): PagoYape[] {
  return [...pagosYape];
}
