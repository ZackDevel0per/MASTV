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
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import multer from "multer";
import { iniciarBot, detenerBot, reiniciarBot, getInstancia, getEstadoTodos } from "../bot/bot-manager.js";
import { recargarTenant } from "../bot/tenant-manager.js";
import { getEventosTenant } from "../bot/bot-events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_HTML = path.resolve(__dirname, "..", "..", "public", "admin", "index.html");
const QR_PAGOS_DIR = path.resolve(__dirname, "..", "..", "public", "qr-pagos");
fs.mkdirSync(QR_PAGOS_DIR, { recursive: true });

const qrStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, QR_PAGOS_DIR),
  filename: (req, _file, cb) => {
    const tenantId = (req.params as { id: string }).id;
    cb(null, `${tenantId}.jpeg`);
  },
});
const uploadQr = multer({
  storage: qrStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Solo se permiten imágenes"));
  },
});

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

function getRedirectUri(req: Request): string {
  const replitDomain = process.env["REPLIT_DEV_DOMAIN"] ?? process.env["REPLIT_DOMAINS"];
  return replitDomain
    ? `https://${replitDomain}/api/gmail/callback`
    : `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers["x-forwarded-host"] ?? req.headers["host"]}/api/gmail/callback`;
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
// OBTENER TENANT INDIVIDUAL (con config completa)
// ═══════════════════════════════════════════════════════════════════════
router.get("/admin/tenants/:id", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, req.params.id as string))
      .limit(1);

    if (!tenant) {
      res.status(404).json({ ok: false, mensaje: "Tenant no encontrado" });
      return;
    }

    const estadosBots = getEstadoTodos() as Array<{ tenantId: string; conectado: boolean; estado: string }>;
    const bot = estadosBots.find((b) => b.tenantId === tenant.id);

    res.json({
      ok: true,
      tenant: {
        ...tenant,
        tieneSheets: !!tenant.spreadsheetId,
        tieneCRM: !!tenant.crmUsername,
        tieneGmail: !!tenant.gmailClientId && !!tenant.gmailRefreshToken,
        bot: bot
          ? { conectado: bot.conectado, estado: bot.estado }
          : { conectado: false, estado: "no_iniciado" },
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SUBIR QR DE PAGO (archivo local por tenant)
// ═══════════════════════════════════════════════════════════════════════
router.post(
  "/admin/tenants/:id/qr-pago",
  (req: Request, res: Response, next) => {
    if (!verificarAdmin(req, res)) return;
    next();
  },
  uploadQr.single("qr"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ ok: false, mensaje: "No se recibió archivo" });
        return;
      }
      const tenantId = req.params.id as string;

      // Construir URL pública del archivo subido
      const replitDomain = process.env["REPLIT_DEV_DOMAIN"] ?? process.env["REPLIT_DOMAINS"];
      const baseUrl = replitDomain
        ? `https://${replitDomain}`
        : `http://localhost:${process.env["PORT"] ?? 8080}`;
      const publicUrl = `${baseUrl}/public/qr-pagos/${tenantId}.jpeg`;

      // Guardar URL en DB
      await db
        .update(tenantsTable)
        .set({ qrPagoUrl: publicUrl })
        .where(eq(tenantsTable.id, tenantId));

      await recargarTenant(tenantId);

      res.json({ ok: true, url: publicUrl, mensaje: "QR de pago actualizado" });
    } catch (err) {
      res.status(500).json({ ok: false, mensaje: String(err) });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS DEL TENANT
// ═══════════════════════════════════════════════════════════════════════
router.get("/admin/tenants/:id/stats", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const tenantId = req.params.id as string;
    const now = new Date();
    const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [pagosTotales, pagosMes, cuentasActivas, cuentasTotal, ultimoPago] = await Promise.all([
      db.select({ count: sql<number>`count(*)` })
        .from(tenantPagosTable)
        .where(eq(tenantPagosTable.tenantId, tenantId)),
      db.select({ count: sql<number>`count(*)`, suma: sql<number>`coalesce(sum(monto), 0)` })
        .from(tenantPagosTable)
        .where(and(
          eq(tenantPagosTable.tenantId, tenantId),
          gte(tenantPagosTable.sincronizadoEn, new Date(primerDiaMes)),
        )),
      db.select({ count: sql<number>`count(*)` })
        .from(tenantCuentasTable)
        .where(and(eq(tenantCuentasTable.tenantId, tenantId), eq(tenantCuentasTable.estado, "ACTIVA"))),
      db.select({ count: sql<number>`count(*)` })
        .from(tenantCuentasTable)
        .where(eq(tenantCuentasTable.tenantId, tenantId)),
      db.select({ fecha: tenantPagosTable.fecha, nombre: tenantPagosTable.nombre, monto: tenantPagosTable.monto, sincronizadoEn: tenantPagosTable.sincronizadoEn })
        .from(tenantPagosTable)
        .where(eq(tenantPagosTable.tenantId, tenantId))
        .orderBy(desc(tenantPagosTable.sincronizadoEn))
        .limit(1),
    ]);

    res.json({
      ok: true,
      stats: {
        pagosTotales: Number(pagosTotales[0]?.count ?? 0),
        pagosMes: Number(pagosMes[0]?.count ?? 0),
        ingresosMes: Number(pagosMes[0]?.suma ?? 0),
        cuentasActivas: Number(cuentasActivas[0]?.count ?? 0),
        cuentasTotal: Number(cuentasTotal[0]?.count ?? 0),
        ultimoPago: ultimoPago[0] ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// LOGS / EVENTOS DEL BOT
// ═══════════════════════════════════════════════════════════════════════
router.get("/admin/tenants/:id/logs", (req, res) => {
  if (!verificarAdmin(req, res)) return;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50")), 100);
  const eventos = getEventosTenant(req.params.id as string, limit);
  res.json({ ok: true, eventos });
});

// ═══════════════════════════════════════════════════════════════════════
// GMAIL OAUTH PER-TENANT
// ═══════════════════════════════════════════════════════════════════════
router.get("/admin/tenants/:id/gmail/autorizar", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const tenantId = req.params.id as string;
    const [tenant] = await db.select({
      gmailClientId: tenantsTable.gmailClientId,
      gmailClientSecret: tenantsTable.gmailClientSecret,
    }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);

    if (!tenant) {
      res.status(404).json({ ok: false, mensaje: "Tenant no encontrado" });
      return;
    }
    if (!tenant.gmailClientId || !tenant.gmailClientSecret) {
      res.status(400).json({ ok: false, mensaje: "El tenant no tiene Gmail Client ID / Secret configurados. Guárdalos primero." });
      return;
    }

    const redirectUri = getRedirectUri(req);
    const oAuth2Client = new google.auth.OAuth2(tenant.gmailClientId, tenant.gmailClientSecret, redirectUri);

    const url = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/gmail.modify"],
      state: tenantId,
    });

    res.json({ ok: true, urlAutorizacion: url, redirectUri });
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
      planesJson, qrPagoUrl, suscripcionVence,
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
      qrPagoUrl: qrPagoUrl || null,
      suscripcionVence: suscripcionVence ? new Date(suscripcionVence) : null,
      activo: true,
    });

    const tenant = await recargarTenant(id);
    if (tenant) await iniciarBot(tenant);

    res.json({ ok: true, tenant: { id }, mensaje: `Tenant ${id} creado y bot iniciado` });
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
      "pushoverUserKey", "pushoverApiToken", "planesJson", "qrPagoUrl", "activo",
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

    await reiniciarBot(id as string);

    res.json({ ok: true, mensaje: `Tenant ${id} actualizado y bot reiniciado` });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ELIMINAR TENANT
// ═══════════════════════════════════════════════════════════════════════
router.delete("/admin/tenants/:id", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const { id } = req.params;
    await detenerBot(id as string);
    await db.delete(tenantsTable).where(eq(tenantsTable.id, id as string));
    res.json({ ok: true, mensaje: `Tenant ${id} eliminado` });
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
    const { desde, hasta, estado } = req.query;
    let query = db.select().from(tenantPagosTable).$dynamic();
    const conditions = [];
    if (desde) conditions.push(gte(tenantPagosTable.sincronizadoEn, new Date(String(desde))));
    if (hasta) conditions.push(lte(tenantPagosTable.sincronizadoEn, new Date(String(hasta))));
    if (estado) conditions.push(eq(tenantPagosTable.estado, String(estado)));
    if (conditions.length) query = query.where(and(...conditions));
    const pagos = await query.orderBy(desc(tenantPagosTable.sincronizadoEn)).limit(500);
    res.json({ ok: true, pagos });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

router.get("/admin/pagos/:tenantId", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const { desde, hasta, estado } = req.query;
    const conditions = [eq(tenantPagosTable.tenantId, req.params.tenantId as string)];
    if (desde) conditions.push(gte(tenantPagosTable.sincronizadoEn, new Date(String(desde))));
    if (hasta) conditions.push(lte(tenantPagosTable.sincronizadoEn, new Date(String(hasta))));
    if (estado) conditions.push(eq(tenantPagosTable.estado, String(estado)));
    const pagos = await db
      .select()
      .from(tenantPagosTable)
      .where(and(...conditions))
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
    const { estado } = req.query;
    let query = db.select().from(tenantCuentasTable).$dynamic();
    if (estado) query = query.where(eq(tenantCuentasTable.estado, String(estado)));
    const cuentas = await query.orderBy(desc(tenantCuentasTable.sincronizadoEn)).limit(1000);
    res.json({ ok: true, cuentas });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err) });
  }
});

router.get("/admin/cuentas/:tenantId", async (req, res) => {
  if (!verificarAdmin(req, res)) return;
  try {
    const { estado } = req.query;
    const conditions = [eq(tenantCuentasTable.tenantId, req.params.tenantId as string)];
    if (estado) conditions.push(eq(tenantCuentasTable.estado, String(estado)));
    const cuentas = await db
      .select()
      .from(tenantCuentasTable)
      .where(and(...conditions))
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
