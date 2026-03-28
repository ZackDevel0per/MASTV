/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                     RUTAS DE SUPERADMIN                              ║
 * ║  Panel de control centralizado para gestionar todos los tenants.    ║
 * ║  Protegido con token de administrador.                               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { tenantsTable, tenantPagosTable, tenantCuentasTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import { iniciarBot, detenerBot, reiniciarBot, getInstancia, getEstadoTodos } from "../bot/bot-manager.js";
import { recargarTenant } from "../bot/tenant-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_HTML = path.resolve(__dirname, "..", "..", "public", "admin", "index.html");

const router: IRouter = Router();

// ── Panel UI ────────────────────────────────────────────────────────────────
router.get("/panel", (_req, res) => {
  res.sendFile(ADMIN_HTML);
});

const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] || "superadmin_token_seguro_2024";
const ADMIN_USER = process.env["ADMIN_USER"] || "admin";
const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] || "admin1234";

function verificarAdmin(req: Request, res: Response): boolean {
  const token = req.headers["x-admin-token"] || req.query["token"] || req.body?.token;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ ok: false, mensaje: "Token de administrador inválido" });
    return false;
  }
  return true;
}

// ── Login con usuario y contraseña ──────────────────────────────────────────
router.post("/admin/login", (req, res) => {
  const { usuario, password } = req.body || {};
  if (usuario === ADMIN_USER && password === ADMIN_PASSWORD) {
    res.json({ ok: true, token: ADMIN_TOKEN, mensaje: "Login exitoso" });
  } else {
    res.status(401).json({ ok: false, mensaje: "Usuario o contraseña incorrectos" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ESTADO GENERAL — todos los bots
// ═══════════════════════════════════════════════════════════════════════
router.get("/admin/estado", (req, res) => {
  if (!verificarAdmin(req, res)) return;
  res.json({ ok: true, bots: getEstadoTodos() });
});

// ═══════════════════════════════════════════════════════════════════════
// LISTAR TENANTS
// ═══════════════════════════════════════════════════════════════════════
router.get("/admin/tenants", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const tenants = await db
      .select({
        id: tenantsTable.id,
        nombre: tenantsTable.nombre,
        nombreEmpresa: tenantsTable.nombreEmpresa,
        adminWhatsapp: tenantsTable.adminWhatsapp,
        activo: tenantsTable.activo,
        suscripcionVence: tenantsTable.suscripcionVence,
        creadoEn: tenantsTable.creadoEn,
        tieneSheets: tenantsTable.spreadsheetId,
        tieneCRM: tenantsTable.crmUsername,
        tieneGmail: tenantsTable.gmailClientId,
      })
      .from(tenantsTable)
      .orderBy(desc(tenantsTable.creadoEn));

    const estadosBots = getEstadoTodos() as Array<{ tenantId: string; conectado: boolean; estado: string }>;

    const resultado = tenants.map((t: typeof tenants[number]) => {
      const bot = estadosBots.find((b) => b.tenantId === t.id);
      return {
        ...t,
        tieneSheets: !!t.tieneSheets,
        tieneCRM: !!t.tieneCRM,
        tieneGmail: !!t.tieneGmail,
        bot: bot
          ? { conectado: bot.conectado, estado: bot.estado }
          : { conectado: false, estado: "no_iniciado" },
      };
    });

    res.json({ ok: true, tenants: resultado });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// CREAR TENANT
// ═══════════════════════════════════════════════════════════════════════
router.post("/admin/tenants", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const {
      id, nombre, nombreEmpresa, adminWhatsapp,
      spreadsheetId, googleServiceAccountJson,
      crmBaseUrl, crmUsername, crmPassword, crmUsernamePrefix,
      gmailClientId, gmailClientSecret, gmailRefreshToken, gmailRemitenteFiltro,
      pushoverUserKey, pushoverApiToken,
      planesJson, suscripcionVence,
    } = req.body;

    if (!id || !nombre || !nombreEmpresa || !adminWhatsapp) {
      res.status(400).json({ ok: false, mensaje: "Se requiere: id, nombre, nombreEmpresa, adminWhatsapp" });
      return;
    }

    await db.insert(tenantsTable).values({
      id, nombre, nombreEmpresa, adminWhatsapp,
      spreadsheetId: spreadsheetId || null,
      googleServiceAccountJson: googleServiceAccountJson || null,
      crmBaseUrl: crmBaseUrl || "https://resellermastv.com:8443",
      crmUsername: crmUsername || null,
      crmPassword: crmPassword || null,
      crmUsernamePrefix: crmUsernamePrefix || "zk",
      gmailClientId: gmailClientId || null,
      gmailClientSecret: gmailClientSecret || null,
      gmailRefreshToken: gmailRefreshToken || null,
      gmailRemitenteFiltro: gmailRemitenteFiltro || null,
      pushoverUserKey: pushoverUserKey || null,
      pushoverApiToken: pushoverApiToken || null,
      planesJson: planesJson || null,
      suscripcionVence: suscripcionVence ? new Date(suscripcionVence) : null,
      activo: true,
    });

    // Iniciar el bot del nuevo tenant
    const tenant = await recargarTenant(id);
    if (tenant) await iniciarBot(tenant);

    res.json({ ok: true, mensaje: `Tenant ${id} creado y bot iniciado` });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// EDITAR TENANT
// ═══════════════════════════════════════════════════════════════════════
router.put("/admin/tenants/:id", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const { id } = req.params;
    const body = req.body;

    const updates: Partial<typeof tenantsTable.$inferInsert> = {};
    const campos = [
      "nombre", "nombreEmpresa", "adminWhatsapp",
      "spreadsheetId", "googleServiceAccountJson",
      "crmBaseUrl", "crmUsername", "crmPassword", "crmUsernamePrefix",
      "gmailClientId", "gmailClientSecret", "gmailRefreshToken", "gmailRemitenteFiltro",
      "pushoverUserKey", "pushoverApiToken", "planesJson", "activo",
    ] as const;

    for (const campo of campos) {
      if (body[campo] !== undefined) {
        (updates as Record<string, unknown>)[campo] = body[campo];
      }
    }
    if (body.suscripcionVence !== undefined) {
      updates.suscripcionVence = body.suscripcionVence ? new Date(body.suscripcionVence) : null;
    }
    updates.actualizadoEn = new Date();

    await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, id as string));

    // Reiniciar el bot con la nueva config
    await reiniciarBot(id as string);

    res.json({ ok: true, mensaje: `Tenant ${id} actualizado y bot reiniciado` });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SUSPENDER / ACTIVAR TENANT
// ═══════════════════════════════════════════════════════════════════════
router.post("/admin/tenants/:id/suspender", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const { id } = req.params;
    await db.update(tenantsTable).set({ activo: false, actualizadoEn: new Date() }).where(eq(tenantsTable.id, id as string));
    await detenerBot(id as string);
    res.json({ ok: true, mensaje: `Tenant ${id} suspendido` });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

router.post("/admin/tenants/:id/activar", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const { id } = req.params;
    await db.update(tenantsTable).set({ activo: true, actualizadoEn: new Date() }).where(eq(tenantsTable.id, id as string));
    const tenant = await recargarTenant(id as string);
    if (tenant) await iniciarBot(tenant);
    res.json({ ok: true, mensaje: `Tenant ${id} activado` });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// BOT ACTIONS por tenant
// ═══════════════════════════════════════════════════════════════════════
router.post("/admin/tenants/:id/bot/reiniciar", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    await reiniciarBot(req.params.id as string);
    res.json({ ok: true, mensaje: `Bot ${req.params.id} reiniciado` });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

router.post("/admin/tenants/:id/bot/codigo-pareo", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const instancia = getInstancia(req.params.id as string);
    if (!instancia) {
      res.status(404).json({ ok: false, mensaje: "Bot no encontrado" });
      return;
    }
    const { telefono } = req.body;
    const codigo = await instancia.solicitarCodigoPareo(telefono);
    res.json({ ok: true, codigo });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

router.post("/admin/tenants/:id/bot/activar", (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const instancia = getInstancia(req.params.id as string);
    if (!instancia) {
      res.status(404).json({ ok: false, mensaje: "Bot no encontrado" });
      return;
    }
    const { activo } = req.body;
    instancia.setBotActivo(!!activo);
    res.json({ ok: true, mensaje: `Bot ${activo ? "activado" : "desactivado"}` });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

router.post("/admin/tenants/:id/bot/sesion/borrar", (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const instancia = getInstancia(req.params.id as string);
    if (!instancia) {
      res.status(404).json({ ok: false, mensaje: "Bot no encontrado" });
      return;
    }
    instancia.borrarSesion();
    res.json({ ok: true, mensaje: "Sesión borrada" });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// VISTA CONSOLIDADA — pagos de todos los tenants
// ═══════════════════════════════════════════════════════════════════════
router.get("/admin/pagos", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const pagos = await db
      .select()
      .from(tenantPagosTable)
      .orderBy(desc(tenantPagosTable.sincronizadoEn))
      .limit(500);
    res.json({ ok: true, pagos });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

router.get("/admin/pagos/:tenantId", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const pagos = await db
      .select()
      .from(tenantPagosTable)
      .where(eq(tenantPagosTable.tenantId, req.params.tenantId as string))
      .orderBy(desc(tenantPagosTable.sincronizadoEn))
      .limit(200);
    res.json({ ok: true, pagos });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// VISTA CONSOLIDADA — cuentas de todos los tenants
// ═══════════════════════════════════════════════════════════════════════
router.get("/admin/cuentas", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const cuentas = await db
      .select()
      .from(tenantCuentasTable)
      .orderBy(desc(tenantCuentasTable.sincronizadoEn))
      .limit(1000);
    res.json({ ok: true, cuentas });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

router.get("/admin/cuentas/:tenantId", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const cuentas = await db
      .select()
      .from(tenantCuentasTable)
      .where(eq(tenantCuentasTable.tenantId, req.params.tenantId as string))
      .orderBy(desc(tenantCuentasTable.sincronizadoEn))
      .limit(500);
    res.json({ ok: true, cuentas });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ENVIAR MENSAJE desde el panel admin
// ═══════════════════════════════════════════════════════════════════════
router.post("/admin/tenants/:id/mensaje", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const instancia = getInstancia(req.params.id as string);
    if (!instancia) {
      res.status(404).json({ ok: false, mensaje: "Bot no encontrado o no iniciado" });
      return;
    }
    const { telefono, mensaje } = req.body;
    if (!telefono || !mensaje) {
      res.status(400).json({ ok: false, mensaje: "Se requiere telefono y mensaje" });
      return;
    }
    await instancia.enviarMensaje(telefono, mensaje);
    res.json({ ok: true, mensaje: "Mensaje enviado" });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

export default router;
