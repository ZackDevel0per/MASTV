/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                       BOT MANAGER                                    ║
 * ║  Gestiona el ciclo de vida de todas las instancias de bot.          ║
 * ║  Una instancia por tenant activo.                                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { BotInstance } from "./bot-instance.js";
import { cargarTenants, recargarTenant } from "./tenant-manager.js";
import type { TenantConfig } from "./tenant-config.js";

const instancias = new Map<string, BotInstance>();

/**
 * Arranca todas las instancias de bot para los tenants activos.
 * Se llama una vez al iniciar el servidor.
 */
export async function iniciarTodosLosBots(): Promise<void> {
  const tenants = await cargarTenants();
  console.log(`\n🚀 [BOT-MGR] Iniciando ${tenants.length} bot(s)...`);

  for (const tenant of tenants) {
    await iniciarBot(tenant);
  }

  console.log(`✅ [BOT-MGR] Todos los bots iniciados.\n`);
}

/**
 * Inicia el bot para un tenant específico.
 */
export async function iniciarBot(tenant: TenantConfig): Promise<void> {
  if (instancias.has(tenant.id)) {
    console.log(`⚠️ [BOT-MGR] Bot ${tenant.id} ya existe. Ignorando.`);
    return;
  }

  try {
    const instancia = new BotInstance(tenant);
    instancias.set(tenant.id, instancia);
    // Iniciar de forma no-bloqueante para no trabar el arranque del servidor
    instancia.iniciar().catch((err) => {
      console.error(`❌ [BOT-MGR] Error iniciando bot ${tenant.id}:`, err);
    });
    console.log(`➕ [BOT-MGR] Bot ${tenant.id} (${tenant.nombre}) registrado`);
  } catch (err) {
    console.error(`❌ [BOT-MGR] Error creando instancia ${tenant.id}:`, err);
  }
}

/**
 * Detiene y elimina el bot de un tenant.
 */
export async function detenerBot(tenantId: string): Promise<void> {
  const instancia = instancias.get(tenantId);
  if (!instancia) return;
  instancia.detener();
  instancias.delete(tenantId);
  console.log(`🔴 [BOT-MGR] Bot ${tenantId} detenido`);
}

/**
 * Reinicia el bot de un tenant (útil tras edición de config).
 */
export async function reiniciarBot(tenantId: string): Promise<void> {
  await detenerBot(tenantId);
  const tenant = await recargarTenant(tenantId);
  if (tenant) {
    await iniciarBot(tenant);
  } else {
    console.log(`⚠️ [BOT-MGR] Tenant ${tenantId} no encontrado o inactivo.`);
  }
}

/**
 * Actualiza la configuración del bot en caliente, sin desconectar WhatsApp.
 * Úsalo en lugar de reiniciarBot para cambios que no afectan la sesión
 * (nombre empresa, planes, pushover, CRM, Gmail, Sheets, etc.).
 */
export async function actualizarConfigBot(tenantId: string): Promise<void> {
  const instancia = instancias.get(tenantId);
  const tenant = await recargarTenant(tenantId);

  if (!tenant) {
    // Si el tenant quedó inactivo, detener el bot
    await detenerBot(tenantId);
    console.log(`⚠️ [BOT-MGR] Tenant ${tenantId} inactivo, bot detenido.`);
    return;
  }

  if (instancia) {
    instancia.actualizarConfig(tenant);
    console.log(`✅ [BOT-MGR] Config de ${tenantId} actualizada en caliente.`);
  } else {
    // Si por algún motivo no hay instancia activa, iniciarla
    await iniciarBot(tenant);
  }
}

/**
 * Devuelve la instancia de bot de un tenant.
 */
export function getInstancia(tenantId: string): BotInstance | undefined {
  return instancias.get(tenantId);
}

/**
 * Devuelve el estado de todos los bots.
 */
export function getEstadoTodos(): object[] {
  return Array.from(instancias.values()).map((i) => i.getEstado());
}
