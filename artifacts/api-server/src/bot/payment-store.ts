/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║        ALMACÉN DE PEDIDOS PENDIENTES DE PAGO             ║
 * ║  Guarda en memoria los planes elegidos por cada cliente  ║
 * ║  hasta que Tasker confirme el pago o el cliente verifique║
 * ╚══════════════════════════════════════════════════════════╝
 */

export type EstadoPedido = "pendiente" | "pagado" | "entregado";

export interface Pedido {
  telefono: string;
  plan: string;
  monto: number;
  estado: EstadoPedido;
  creadoEn: number;
  pagadoEn?: number;
  entregadoEn?: number;
  usuario?: string;
}

const pedidos = new Map<string, Pedido>();

/** Registra o actualiza el plan que el cliente quiere contratar */
export function registrarPedido(telefono: string, plan: string, monto: number): void {
  const existente = pedidos.get(telefono);
  if (existente?.estado === "pagado") return; // no sobreescribir un pago confirmado
  pedidos.set(telefono, {
    telefono,
    plan,
    monto,
    estado: "pendiente",
    creadoEn: Date.now(),
  });
  console.log(`📋 [PEDIDO] Registrado: ${telefono} → ${plan} (Bs ${monto})`);
}

/** Obtiene el pedido activo de un cliente */
export function obtenerPedido(telefono: string): Pedido | undefined {
  return pedidos.get(telefono);
}

/**
 * Confirma el pago de un cliente (llamado desde el endpoint de Tasker).
 * Devuelve el pedido si el monto coincide con el plan, o null si no hay pedido
 * o el monto no corresponde.
 */
export function confirmarPago(telefono: string, montoRecibido: number): Pedido | null {
  const pedido = pedidos.get(telefono);
  if (!pedido) {
    console.warn(`⚠️  [PEDIDO] No hay pedido activo para ${telefono}`);
    return null;
  }
  if (pedido.estado === "entregado") {
    console.warn(`⚠️  [PEDIDO] Pedido de ${telefono} ya fue entregado`);
    return null;
  }
  // Tolerancia del 5% para diferencias de redondeo
  const diferencia = Math.abs(pedido.monto - montoRecibido) / pedido.monto;
  if (diferencia > 0.05) {
    console.warn(`⚠️  [PEDIDO] Monto no coincide para ${telefono}: esperado=${pedido.monto} recibido=${montoRecibido}`);
    return null;
  }
  pedido.estado = "pagado";
  pedido.pagadoEn = Date.now();
  console.log(`✅ [PEDIDO] Pago confirmado: ${telefono} → ${pedido.plan} (Bs ${montoRecibido})`);
  return pedido;
}

/**
 * Busca un pedido pendiente cuyo monto coincida con el recibido (tolerancia 5%).
 * Se usa cuando Tasker solo tiene el nombre y monto de la notificación,
 * sin el número de teléfono del cliente.
 * Devuelve el primer pedido que coincida, o null si no hay ninguno.
 */
export function buscarPedidoPorMonto(montoRecibido: number, nombrePagador?: string): Pedido | null {
  let candidatos: Pedido[] = [];

  for (const pedido of pedidos.values()) {
    if (pedido.estado === "entregado" || pedido.estado === "pagado") continue;
    const diferencia = Math.abs(pedido.monto - montoRecibido) / pedido.monto;
    if (diferencia <= 0.05) {
      candidatos.push(pedido);
    }
  }

  if (candidatos.length === 0) {
    console.warn(`⚠️  [PEDIDO] Ningún pedido pendiente con monto Bs. ${montoRecibido}`);
    return null;
  }

  // Si hay más de un candidato con el mismo monto, tomar el más antiguo
  // (el primero en haber hecho el pedido)
  candidatos.sort((a, b) => a.creadoEn - b.creadoEn);
  const pedido = candidatos[0]!;

  pedido.estado = "pagado";
  pedido.pagadoEn = Date.now();
  console.log(
    `✅ [PEDIDO] Pago confirmado por monto: ${pedido.telefono} → ${pedido.plan} (Bs ${montoRecibido})` +
    (nombrePagador ? ` | Pagador: ${nombrePagador}` : "")
  );
  return pedido;
}

/** Marca un pedido como entregado (cuenta creada y enviada) */
export function marcarEntregado(telefono: string, usuario: string): void {
  const pedido = pedidos.get(telefono);
  if (pedido) {
    pedido.estado = "entregado";
    pedido.entregadoEn = Date.now();
    pedido.usuario = usuario;
    console.log(`🎉 [PEDIDO] Entregado: ${telefono} → usuario: ${usuario}`);
  }
}

/** Limpia pedidos viejos (más de 24 horas sin completarse) */
export function limpiarPedidosViejos(): void {
  const limite = Date.now() - 24 * 60 * 60 * 1000;
  for (const [tel, pedido] of pedidos.entries()) {
    if (pedido.creadoEn < limite && pedido.estado !== "entregado") {
      pedidos.delete(tel);
    }
  }
}

// Limpiar cada hora
setInterval(limpiarPedidosViejos, 60 * 60 * 1000);
