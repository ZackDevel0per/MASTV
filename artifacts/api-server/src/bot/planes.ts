/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         PLANES DE SERVICIO - EDITABLE                    ║
 * ║  Agrega, edita o elimina planes según tu negocio         ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Cada plan tiene:
 *   codigo      → el número que escribe el cliente (ej: "1A1M")
 *   nombre      → nombre del plan
 *   monto       → precio en Bs
 *   descripcion → descripción que ve el cliente al elegirlo
 *   tolerancia  → diferencia máxima aceptada en el pago (ej: 1 = ±1 Bs)
 *   dispositivos → cantidad de dispositivos
 *   duracion    → duración en meses
 */

export interface Plan {
  codigo: string;
  nombre: string;
  monto: number;
  descripcion: string;
  tolerancia: number;
  dispositivos: number;
  duracion: string;
}

export const PLANES: Plan[] = [
  // ═══════════════════════════════════════════════════════════
  // 1 DISPOSITIVO
  // ═══════════════════════════════════════════════════════════
  {
    codigo: "1D1M",
    nombre: "1 Dispositivo - 1 Mes",
    monto: 29,
    descripcion: "📺 *1 Dispositivo - 1 Mes*\n💰 Bs 29\n✅ Acceso a todos nuestros canales, series y peliculas",
    tolerancia: 1,
    dispositivos: 1,
    duracion: "1 mes",
  },
  {
    codigo: "1D3M",
    nombre: "1 Dispositivo - 3 Meses",
    monto: 82,
    descripcion: "📺 *1 Dispositivo - 3 Meses*\n💰 Bs 82\n✅ Acceso a todos nuestros canales, series y peliculas",
    tolerancia: 1,
    dispositivos: 1,
    duracion: "3 meses",
  },
  {
    codigo: "1D6M",
    nombre: "1 Dispositivo - 6 Meses + 1 GRATIS",
    monto: 155,
    descripcion: "📺 *1 Dispositivo - 6 Meses + 1 GRATIS*\n💰 Bs 155\n🎁 +1 mes gratis\n✅ Total: 7 meses",
    tolerancia: 1,
    dispositivos: 1,
    duracion: "6 meses + 1 gratis",
  },
  {
    codigo: "1D12M",
    nombre: "1 Dispositivo - 12 Meses + 2 GRATIS",
    monto: 300,
    descripcion: "📺 *1 Dispositivo - 12 Meses + 2 GRATIS*\n💰 Bs 300\n🎁 +2 meses gratis\n✅ Total: 14 meses",
    tolerancia: 1,
    dispositivos: 1,
    duracion: "12 meses + 2 gratis",
  },

  // ═══════════════════════════════════════════════════════════
  // 2 DISPOSITIVOS
  // ═══════════════════════════════════════════════════════════
  {
    codigo: "2D1M",
    nombre: "2 Dispositivos - 1 Mes",
    monto: 35,
    descripcion: "📺 *2 Dispositivos - 1 Mes*\n💰 Bs 35\n✅ Mira en 2 dispositivos simultáneamente",
    tolerancia: 1,
    dispositivos: 2,
    duracion: "1 mes",
  },
  {
    codigo: "2D3M",
    nombre: "2 Dispositivos - 3 Meses",
    monto: 100,
    descripcion: "📺 *2 Dispositivos - 3 Meses*\n💰 Bs 100\n✅ Mira en 2 dispositivos simultáneamente",
    tolerancia: 1,
    dispositivos: 2,
    duracion: "3 meses",
  },
  {
    codigo: "2D6M",
    nombre: "2 Dispositivos - 6 Meses + 1 GRATIS",
    monto: 190,
    descripcion: "📺 *2 Dispositivos - 6 Meses + 1 GRATIS*\n💰 Bs 190\n🎁 +1 mes gratis\n✅ Total: 7 meses",
    tolerancia: 1,
    dispositivos: 2,
    duracion: "6 meses + 1 gratis",
  },
  {
    codigo: "2D12M",
    nombre: "2 Dispositivos - 12 Meses + 2 GRATIS",
    monto: 380,
    descripcion: "📺 *2 Dispositivos - 12 Meses + 2 GRATIS*\n💰 Bs 380\n🎁 +2 meses gratis\n✅ Total: 14 meses",
    tolerancia: 1,
    dispositivos: 2,
    duracion: "12 meses + 2 gratis",
  },

  // ═══════════════════════════════════════════════════════════
  // 3 DISPOSITIVOS
  // ═══════════════════════════════════════════════════════════
  {
    codigo: "3D1M",
    nombre: "3 Dispositivos - 1 Mes",
    monto: 40,
    descripcion: "📺 *3 Dispositivos - 1 Mes*\n💰 Bs 40\n✅ Mira en 3 dispositivos simultáneamente",
    tolerancia: 1,
    dispositivos: 3,
    duracion: "1 mes",
  },
  {
    codigo: "3D3M",
    nombre: "3 Dispositivos - 3 Meses",
    monto: 115,
    descripcion: "📺 *3 Dispositivos - 3 Meses*\n💰 Bs 115\n✅ Mira en 3 dispositivos simultáneamente",
    tolerancia: 1,
    dispositivos: 3,
    duracion: "3 meses",
  },
  {
    codigo: "3D6M",
    nombre: "3 Dispositivos - 6 Meses + 1 GRATIS",
    monto: 225,
    descripcion: "📺 *3 Dispositivos - 6 Meses + 1 GRATIS*\n💰 Bs 225\n🎁 +1 mes gratis\n✅ Total: 7 meses",
    tolerancia: 1,
    dispositivos: 3,
    duracion: "6 meses + 1 gratis",
  },
  {
    codigo: "3D12M",
    nombre: "3 Dispositivos - 12 Meses + 2 GRATIS",
    monto: 440,
    descripcion: "📺 *3 Dispositivos - 12 Meses + 2 GRATIS*\n💰 Bs 440\n🎁 +2 meses gratis\n✅ Total: 14 meses",
    tolerancia: 1,
    dispositivos: 3,
    duracion: "12 meses + 2 gratis",
  },
];

export function buscarPlanPorCodigo(codigo: string): Plan | null {
  return PLANES.find((p) => p.codigo === codigo.trim()) ?? null;
}

export function buscarPlanPorMonto(monto: number): Plan | null {
  return (
    PLANES.find((p) => p.monto > 0 && Math.abs(p.monto - monto) <= p.tolerancia) ?? null
  );
}

export function validarMontoPlan(plan: Plan, montoRecibido: number): boolean {
  if (plan.monto === 0) return true;
  return Math.abs(plan.monto - montoRecibido) <= plan.tolerancia;
}

export function listarPlanesPorDispositivos(dispositivos: number): string {
  const planesFiltrados = PLANES.filter((p) => p.dispositivos === dispositivos);
  if (planesFiltrados.length === 0) return "";

  return (
    `📺 *${dispositivos} Dispositivo${dispositivos > 1 ? "s" : ""}*\n\n` +
    planesFiltrados
      .map(
        (p) =>
          `*${p.duracion.toUpperCase()}* → Bs ${p.monto}\n_${p.descripcion.split("\n")[2] || ""}_`
      )
      .join("\n\n")
  );
}
