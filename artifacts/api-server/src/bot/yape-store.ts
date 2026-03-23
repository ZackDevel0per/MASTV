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
 * Busca un pago no usado con nombre y monto exactos.
 * Si lo encuentra, lo marca como usado y devuelve true.
 * Comparación exacta: mismo nombre (mayúsculas) y mismo monto numérico.
 */
export function buscarYUsarPagoLocal(nombre: string, monto: number): boolean {
  const nombreBuscado = nombre.toUpperCase().trim();

  const index = pagosYape.findIndex(
    (p) => !p.usado && p.nombre === nombreBuscado && p.monto === monto
  );

  if (index === -1) {
    console.warn(`⚠️  [YAPE-LOCAL] Pago no encontrado: "${nombreBuscado}" → Bs ${monto}`);
    console.warn(`📋 [YAPE-LOCAL] Pagos disponibles: ${JSON.stringify(pagosYape.map(p => ({ nombre: p.nombre, monto: p.monto, usado: p.usado })))}`);
    return false;
  }

  pagosYape[index]!.usado = true;
  console.log(`✅ [YAPE-LOCAL] Pago encontrado y marcado como usado: "${nombreBuscado}" → Bs ${monto}`);
  return true;
}

/** Lista todos los pagos (para debug) */
export function listarPagosYape(): PagoYape[] {
  return [...pagosYape];
}
