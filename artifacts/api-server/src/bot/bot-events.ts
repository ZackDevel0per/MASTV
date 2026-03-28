/**
 * Sistema de registro de eventos por bot/tenant en memoria.
 * Circular buffer de hasta MAX_EVENTS eventos por tenant.
 */

export type EventoTipo = "pago" | "cuenta" | "error" | "mensaje" | "conexion" | "info" | "gmail" | "crm";

export interface BotEvento {
  tenantId: string;
  tipo: EventoTipo;
  texto: string;
  ts: string; // ISO string
}

const MAX_EVENTS_PER_TENANT = 100;
const eventos = new Map<string, BotEvento[]>();

export function registrarEvento(tenantId: string, tipo: EventoTipo, texto: string): void {
  if (!eventos.has(tenantId)) eventos.set(tenantId, []);
  const lista = eventos.get(tenantId)!;
  lista.unshift({ tenantId, tipo, texto, ts: new Date().toISOString() });
  if (lista.length > MAX_EVENTS_PER_TENANT) lista.pop();
}

export function getEventosTenant(tenantId: string, limit = 50): BotEvento[] {
  return (eventos.get(tenantId) || []).slice(0, limit);
}

export function limpiarEventosTenant(tenantId: string): void {
  eventos.delete(tenantId);
}
