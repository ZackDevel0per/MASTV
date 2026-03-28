/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                      TENANT MANAGER                                 ║
 * ║  Carga, cachea y gestiona los tenants activos desde la base de datos║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { tenantFromDb, type TenantConfig } from "./tenant-config.js";

const cache = new Map<string, TenantConfig>();
let cargadoEn = 0;
const CACHE_TTL_MS = 60_000; // Refrescar cada 60 segundos

/**
 * Carga todos los tenants activos desde la DB y los cachea en memoria.
 */
export async function cargarTenants(): Promise<TenantConfig[]> {
  try {
    const rows = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.activo, true));

    cache.clear();
    for (const row of rows) {
      const config = tenantFromDb(row);
      cache.set(config.id, config);
    }
    cargadoEn = Date.now();

    console.log(`👥 [TENANTS] ${cache.size} tenant(s) activos cargados`);
    return Array.from(cache.values());
  } catch (err) {
    console.error("[TENANTS] Error cargando tenants:", err);
    return Array.from(cache.values());
  }
}

/**
 * Devuelve todos los tenants activos (desde caché o recarga si expiró).
 */
export async function getTenants(): Promise<TenantConfig[]> {
  if (Date.now() - cargadoEn > CACHE_TTL_MS || cache.size === 0) {
    await cargarTenants();
  }
  return Array.from(cache.values());
}

/**
 * Devuelve un tenant por ID desde caché.
 */
export function getTenantById(id: string): TenantConfig | undefined {
  return cache.get(id);
}

/**
 * Recarga un tenant específico desde DB (útil tras edición por admin).
 */
export async function recargarTenant(id: string): Promise<TenantConfig | null> {
  try {
    const rows = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id));

    if (rows.length === 0) {
      cache.delete(id);
      return null;
    }

    const config = tenantFromDb(rows[0]!);
    if (rows[0]!.activo) {
      cache.set(id, config);
    } else {
      cache.delete(id);
    }
    return config;
  } catch (err) {
    console.error(`[TENANTS] Error recargando tenant ${id}:`, err);
    return null;
  }
}

/**
 * Fuerza la limpieza del caché para próxima consulta.
 */
export function invalidarCache(): void {
  cargadoEn = 0;
}
