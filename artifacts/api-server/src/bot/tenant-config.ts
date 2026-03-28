/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║               TIPOS DE CONFIGURACIÓN POR TENANT                     ║
 * ║  Cada tenant (cliente) tiene su propio conjunto de credenciales     ║
 * ║  y configuraciones. Este es el contrato central del sistema.        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export interface TenantConfig {
  // Identidad
  id: string;
  nombre: string;
  nombreEmpresa: string;
  adminWhatsapp: string;

  // Google Sheets (datos de clientes)
  spreadsheetId: string | null;
  googleServiceAccountJson: string | null;

  // CRM IPTV
  crmBaseUrl: string;
  crmUsername: string | null;
  crmPassword: string | null;
  crmUsernamePrefix: string;

  // Gmail (detección de pagos automática)
  gmailClientId: string | null;
  gmailClientSecret: string | null;
  gmailRefreshToken: string | null;
  gmailRemitenteFiltro: string | null;

  // Planes personalizados (sobreescribe los defaults)
  planes: TenantPlan[] | null;

  // Pushover (notificaciones al admin del tenant)
  pushoverUserKey: string | null;
  pushoverApiToken: string | null;
}

export interface TenantPlan {
  codigo: string;
  nombre: string;
  monto: number;
  descripcion: string;
  tolerancia: number;
  dispositivos: number;
  duracion: string;
  dias: number;
  crmPlanId?: string;
}

/**
 * Construye un TenantConfig desde un registro de la tabla tenants de la DB.
 */
export function tenantFromDb(row: {
  id: string;
  nombre: string;
  nombreEmpresa: string;
  adminWhatsapp: string;
  spreadsheetId: string | null;
  googleServiceAccountJson: string | null;
  crmBaseUrl: string | null;
  crmUsername: string | null;
  crmPassword: string | null;
  crmUsernamePrefix: string | null;
  gmailClientId: string | null;
  gmailClientSecret: string | null;
  gmailRefreshToken: string | null;
  gmailRemitenteFiltro: string | null;
  planesJson: string | null;
  pushoverUserKey: string | null;
  pushoverApiToken: string | null;
}): TenantConfig {
  let planes: TenantPlan[] | null = null;
  if (row.planesJson) {
    try {
      planes = JSON.parse(row.planesJson);
    } catch {
      planes = null;
    }
  }

  return {
    id: row.id,
    nombre: row.nombre,
    nombreEmpresa: row.nombreEmpresa,
    adminWhatsapp: row.adminWhatsapp,
    spreadsheetId: row.spreadsheetId,
    googleServiceAccountJson: row.googleServiceAccountJson,
    crmBaseUrl: row.crmBaseUrl ?? "https://resellermastv.com:8443",
    crmUsername: row.crmUsername,
    crmPassword: row.crmPassword,
    crmUsernamePrefix: row.crmUsernamePrefix ?? "zk",
    gmailClientId: row.gmailClientId,
    gmailClientSecret: row.gmailClientSecret,
    gmailRefreshToken: row.gmailRefreshToken,
    gmailRemitenteFiltro: row.gmailRemitenteFiltro,
    planes,
    pushoverUserKey: row.pushoverUserKey,
    pushoverApiToken: row.pushoverApiToken,
  };
}
