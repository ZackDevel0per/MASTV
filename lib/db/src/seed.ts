/**
 * Seed de tenants de prueba para la plataforma multi-tenant.
 * Ejecutar con: pnpm --filter @workspace/db tsx src/seed.ts
 */
import { db, pool } from "./index.js";
import { tenantsTable } from "./schema/index.js";

async function seed() {
  console.log("🌱 Insertando tenants de prueba...");

  // Tenant 1: ZKTV - el bot original, con las credenciales reales del sistema
  await db
    .insert(tenantsTable)
    .values({
      id: "zktv",
      nombre: "ZKTV",
      nombreEmpresa: "ZKTV Bolivia",
      adminWhatsapp: process.env["ADMIN_WHATSAPP"] || "59169741630",
      spreadsheetId: process.env["SPREADSHEET_ID"] || "1IMij-hFLASRGFmIksZVH6lZLJtILze4ts60xGaqKi8U",
      googleServiceAccountJson: process.env["GOOGLE_SERVICE_ACCOUNT_JSON"] || null,
      crmBaseUrl: "https://resellermastv.com:8443",
      crmUsername: process.env["CRM_USERNAME"] || "Zack",
      crmPassword: process.env["CRM_PASSWORD"] || "ZackDeveloper7889",
      crmUsernamePrefix: "zk",
      gmailClientId: process.env["GMAIL_CLIENT_ID"] || null,
      gmailClientSecret: process.env["GMAIL_CLIENT_SECRET"] || null,
      gmailRefreshToken: process.env["GMAIL_REFRESH_TOKEN"] || null,
      gmailRemitenteFiltro: process.env["GMAIL_REMITENTE_FILTRO"] || "PagosBcp@bcp.com.bo",
      pushoverUserKey: process.env["PUSHOVER_USER_KEY"] || null,
      pushoverApiToken: process.env["PUSHOVER_APP_TOKEN"] || null,
      activo: true,
    })
    .onConflictDoUpdate({
      target: tenantsTable.id,
      set: {
        nombre: "ZKTV",
        nombreEmpresa: "ZKTV Bolivia",
        actualizadoEn: new Date(),
      },
    });

  console.log("  ✅ Tenant 'zktv' insertado");

  // Tenant 2: Demo cliente - inactivo hasta configurar credenciales
  await db
    .insert(tenantsTable)
    .values({
      id: "demo-cliente",
      nombre: "Demo TV",
      nombreEmpresa: "Demo TV Bolivia",
      adminWhatsapp: "59100000000",
      crmBaseUrl: "https://resellermastv.com:8443",
      crmUsernamePrefix: "dc",
      activo: false,
    })
    .onConflictDoUpdate({
      target: tenantsTable.id,
      set: {
        nombre: "Demo TV",
        actualizadoEn: new Date(),
      },
    });

  console.log("  ✅ Tenant 'demo-cliente' insertado (inactivo)");

  // Verificar
  const tenants = await db.select({ id: tenantsTable.id, nombre: tenantsTable.nombre, activo: tenantsTable.activo }).from(tenantsTable);
  console.log("\n📋 Tenants en DB:");
  for (const t of tenants) {
    console.log(`  - ${t.id}: ${t.nombre} (activo=${t.activo})`);
  }

  await pool.end();
  console.log("\n✅ Seed completo");
}

seed().catch((err) => {
  console.error("❌ Error en seed:", err);
  process.exit(1);
});
