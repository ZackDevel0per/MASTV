/**
 * Seed de tenants de prueba. Ejecutar una sola vez.
 * pnpm --filter @workspace/api-server exec tsx src/seed-tenants.ts
 */
import { db, pool, tenantsTable } from "@workspace/db";

async function seed() {
  console.log("🌱 Insertando tenants de prueba...");

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
      set: { nombre: "ZKTV", nombreEmpresa: "ZKTV Bolivia", actualizadoEn: new Date() },
    });

  console.log("  ✅ zktv insertado");

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
      set: { nombre: "Demo TV", actualizadoEn: new Date() },
    });

  console.log("  ✅ demo-cliente insertado (inactivo)");

  const tenants = await db
    .select({ id: tenantsTable.id, nombre: tenantsTable.nombre, activo: tenantsTable.activo })
    .from(tenantsTable);

  console.log("\n📋 Tenants en DB:");
  for (const t of tenants) {
    console.log(`  - ${t.id}: ${t.nombre} (activo=${t.activo})`);
  }

  await pool.end();
  console.log("✅ Seed completo");
}

seed().catch((e) => { console.error("❌ Error:", e); process.exit(1); });
