import {
  pgTable,
  text,
  boolean,
  timestamp,
  serial,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ═══════════════════════════════════════════════════════════════════════════════
// TENANTS — Un registro por cada cliente/empresa que usa el bot
// ═══════════════════════════════════════════════════════════════════════════════
export const tenantsTable = pgTable("tenants", {
  id: text("id").primaryKey(),
  nombre: text("nombre").notNull(),
  nombreEmpresa: text("nombre_empresa").notNull(),
  adminWhatsapp: text("admin_whatsapp").notNull(),

  // Google Sheets
  spreadsheetId: text("spreadsheet_id"),
  googleServiceAccountJson: text("google_service_account_json"),

  // CRM IPTV
  crmBaseUrl: text("crm_base_url").default("https://resellermastv.com:8443"),
  crmUsername: text("crm_username"),
  crmPassword: text("crm_password"),
  crmUsernamePrefix: text("crm_username_prefix").default("zk"),

  // Gmail (para detección automática de pagos) — LEGACY, mantenido para referencia futura
  gmailClientId: text("gmail_client_id"),
  gmailClientSecret: text("gmail_client_secret"),
  gmailRefreshToken: text("gmail_refresh_token"),
  gmailRemitenteFiltro: text("gmail_remitente_filtro"),

  // VeriPagos.com — generación y verificación automática de QR de pago
  veripagosUsername: text("veripagos_username"),
  veripagosPassword: text("veripagos_password"),

  // Personalización de respuestas y planes (JSON)
  planesJson: text("planes_json"),

  // QR de pago (imagen que el bot envía al cliente para que pague)
  qrPagoUrl: text("qr_pago_url"),

  // Pushover (notificaciones al admin)
  pushoverUserKey: text("pushover_user_key"),
  pushoverApiToken: text("pushover_api_token"),

  // Suscripción del tenant conmigo (superadmin)
  activo: boolean("activo").default(true).notNull(),
  suscripcionVence: timestamp("suscripcion_vence"),

  // Metadata
  creadoEn: timestamp("creado_en").defaultNow().notNull(),
  actualizadoEn: timestamp("actualizado_en").defaultNow().notNull(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({
  creadoEn: true,
  actualizadoEn: true,
});
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// TENANT_PAGOS — Copia central de pagos de todos los tenants (para auditoría)
// ═══════════════════════════════════════════════════════════════════════════════
export const tenantPagosTable = pgTable("tenant_pagos", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  fecha: text("fecha").notNull(),
  nombre: text("nombre").notNull(),
  monto: real("monto").notNull(),
  telefono: text("telefono"),
  fechaRegistro: text("fecha_registro"),
  estado: text("estado").notNull().default("No usado"),
  gmailId: text("gmail_id"),
  sincronizadoEn: timestamp("sincronizado_en").defaultNow().notNull(),
});

export const insertTenantPagoSchema = createInsertSchema(tenantPagosTable).omit({
  id: true,
  sincronizadoEn: true,
});
export type InsertTenantPago = z.infer<typeof insertTenantPagoSchema>;
export type TenantPago = typeof tenantPagosTable.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// TENANT_CUENTAS — Copia central de cuentas de todos los tenants (para auditoría)
// ═══════════════════════════════════════════════════════════════════════════════
export const tenantCuentasTable = pgTable("tenant_cuentas", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  telefono: text("telefono").notNull(),
  usuario: text("usuario").notNull(),
  plan: text("plan").notNull(),
  fechaCreacion: text("fecha_creacion"),
  fechaExpiracion: text("fecha_expiracion"),
  estado: text("estado").notNull().default("ACTIVA"),
  sincronizadoEn: timestamp("sincronizado_en").defaultNow().notNull(),
});

export const insertTenantCuentaSchema = createInsertSchema(tenantCuentasTable).omit({
  id: true,
  sincronizadoEn: true,
});
export type InsertTenantCuenta = z.infer<typeof insertTenantCuentaSchema>;
export type TenantCuenta = typeof tenantCuentasTable.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN_SESSIONS — Sesiones del panel de superadmin
// ═══════════════════════════════════════════════════════════════════════════════
export const adminSessionsTable = pgTable("admin_sessions", {
  token: text("token").primaryKey(),
  creadoEn: timestamp("creado_en").defaultNow().notNull(),
  expiraEn: timestamp("expira_en").notNull(),
});

export type AdminSession = typeof adminSessionsTable.$inferSelect;
