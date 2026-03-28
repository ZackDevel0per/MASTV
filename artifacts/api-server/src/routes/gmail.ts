/**
 * Rutas para gestionar la integración con Gmail.
 *
 * Endpoints:
 *   GET  /api/gmail/estado      — Ver si Gmail está activo y configurado
 *   GET  /api/gmail/autorizar   — Obtener la URL de autorización (visitar una vez)
 *   GET  /api/gmail/callback    — Recibe el código OAuth2. Si state=tenantId, guarda en DB automáticamente.
 *   POST /api/gmail/pausar      — Pausar/reanudar el polling
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  getGmailEstado,
  getUltimoCorreoFallido,
  generarUrlAutorizacion,
  intercambiarCodigo,
  iniciarGmailPolling,
  detenerGmailPolling,
} from "../bot/gmail-service.js";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import { reiniciarBot } from "../bot/bot-manager.js";

const router: IRouter = Router();

function getRedirectUri(req: Request): string {
  const replitDomain = process.env["REPLIT_DEV_DOMAIN"] ?? process.env["REPLIT_DOMAINS"];
  return replitDomain
    ? `https://${replitDomain}/api/gmail/callback`
    : `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers["x-forwarded-host"] ?? req.headers["host"]}/api/gmail/callback`;
}

// ═════════════════════════════════════════════════════════
// ESTADO DE GMAIL
// ═════════════════════════════════════════════════════════
router.get("/gmail/estado", (_req: Request, res: Response) => {
  const estado = getGmailEstado();
  res.json({ ok: true, ...estado });
});

// ═════════════════════════════════════════════════════════
// GENERAR URL DE AUTORIZACIÓN (visitar en el navegador UNA VEZ)
// ═════════════════════════════════════════════════════════
router.get("/gmail/autorizar", (req: Request, res: Response) => {
  try {
    const redirectUri = getRedirectUri(req);
    const url = generarUrlAutorizacion(redirectUri);

    res.json({
      ok: true,
      instrucciones: [
        "1. Abre la URL de abajo en tu navegador",
        "2. Inicia sesión con tu cuenta Gmail personal",
        "3. Acepta los permisos solicitados",
        "4. Serás redirigido de vuelta y verás tu GMAIL_REFRESH_TOKEN",
        "5. Guarda ese token en Replit → Secrets como GMAIL_REFRESH_TOKEN",
        "6. Reinicia el servidor para activar el polling automático",
      ],
      redirectUri,
      urlAutorizacion: url,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error generando URL",
    });
  }
});

// ═════════════════════════════════════════════════════════
// GENERAR URL DE AUTORIZACIÓN POR TENANT
// ═════════════════════════════════════════════════════════
router.get("/gmail/autorizar/:tenantId", async (req: Request, res: Response) => {
  const { tenantId } = req.params as { tenantId: string };
  try {
    const [tenant] = await db
      .select({ gmailClientId: tenantsTable.gmailClientId, gmailClientSecret: tenantsTable.gmailClientSecret })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!tenant) {
      res.status(404).json({ ok: false, mensaje: "Tenant no encontrado" });
      return;
    }
    if (!tenant.gmailClientId || !tenant.gmailClientSecret) {
      res.status(400).json({ ok: false, mensaje: "El tenant no tiene Client ID o Client Secret de Gmail configurados. Edita el tenant primero." });
      return;
    }

    const redirectUri = getRedirectUri(req);
    const oAuth2Client = new google.auth.OAuth2(tenant.gmailClientId, tenant.gmailClientSecret, redirectUri);
    const url = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/gmail.readonly"],
      state: tenantId,
    });

    res.json({ ok: true, urlAutorizacion: url, redirectUri });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err instanceof Error ? err.message : "Error generando URL" });
  }
});

// ═════════════════════════════════════════════════════════
// CALLBACK OAuth2 — Recibe el code y devuelve el refresh_token
// Si state=tenantId, guarda automáticamente en la DB del tenant
// ═════════════════════════════════════════════════════════
router.get("/gmail/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  const error = req.query["error"] as string | undefined;
  const state = req.query["state"] as string | undefined; // tenantId si viene del panel

  if (error) {
    res.status(400).send(`
      <html><body style="font-family:monospace;padding:2rem">
        <h2>❌ Autorización rechazada</h2>
        <p>Error: ${error}</p>
        <p>Vuelve a intentarlo desde el panel.</p>
      </body></html>
    `);
    return;
  }

  if (!code) {
    res.status(400).send(`
      <html><body style="font-family:monospace;padding:2rem">
        <h2>❌ No se recibió código de autorización</h2>
      </body></html>
    `);
    return;
  }

  const redirectUri = getRedirectUri(req);

  // ── Flujo per-tenant (viene del panel admin) ────────────────────────────
  if (state && state.length > 0 && state !== "global") {
    try {
      const tenantId = state;
      const [tenant] = await db
        .select({ gmailClientId: tenantsTable.gmailClientId, gmailClientSecret: tenantsTable.gmailClientSecret })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1);

      if (!tenant?.gmailClientId || !tenant?.gmailClientSecret) {
        res.status(400).send(`<html><body style="font-family:monospace;padding:2rem"><h2>❌ Tenant sin credenciales Gmail</h2><p>El tenant <strong>${tenantId}</strong> no tiene Client ID o Client Secret configurados.</p></body></html>`);
        return;
      }

      const oAuth2Client = new google.auth.OAuth2(tenant.gmailClientId, tenant.gmailClientSecret, redirectUri);
      const { tokens } = await oAuth2Client.getToken(code);
      const refreshToken = tokens.refresh_token;

      if (!refreshToken) {
        res.status(400).send(`<html><body style="font-family:monospace;padding:2rem"><h2>⚠️ No se obtuvo refresh_token</h2><p>Google no devolvió un refresh_token. Asegúrate de haber revocado el acceso previo en <a href="https://myaccount.google.com/permissions">Google Account Permissions</a> y reintenta.</p></body></html>`);
        return;
      }

      await db.update(tenantsTable)
        .set({ gmailRefreshToken: refreshToken, actualizadoEn: new Date() })
        .where(eq(tenantsTable.id, tenantId));

      // Reiniciar el bot para que tome el nuevo token
      reiniciarBot(tenantId).catch(() => {});

      const panelDomain = process.env["REPLIT_DEV_DOMAIN"] ?? process.env["REPLIT_DOMAINS"];
      const panelUrl = panelDomain ? `https://${panelDomain}/api/panel` : "/api/panel";

      res.send(`
        <html>
        <head><meta charset="utf-8"><title>Gmail Autorizado</title></head>
        <body style="font-family:system-ui,sans-serif;padding:2rem;max-width:600px;margin:0 auto;background:#0f1117;color:#fff">
          <div style="background:#10b981;color:#fff;padding:1rem 1.5rem;border-radius:12px;margin-bottom:1.5rem">
            <h2 style="margin:0">✅ Gmail autorizado correctamente</h2>
          </div>
          <p>El tenant <strong>${tenantId}</strong> ha sido autorizado con Gmail.</p>
          <p style="color:#6b7280">El bot se reiniciará automáticamente con las nuevas credenciales. Puedes cerrar esta ventana.</p>
          <a href="${panelUrl}" style="display:inline-block;margin-top:1rem;padding:0.75rem 1.5rem;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">← Volver al Panel</a>
        </body>
        </html>
      `);
    } catch (err) {
      res.status(500).send(`<html><body style="font-family:monospace;padding:2rem"><h2>❌ Error al obtener el token</h2><p>${err instanceof Error ? err.message : String(err)}</p></body></html>`);
    }
    return;
  }

  // ── Flujo global (legacy) ───────────────────────────────────────────────
  try {
    const refreshToken = await intercambiarCodigo(code, redirectUri);

    res.send(`
      <html><body style="font-family:monospace;padding:2rem;max-width:700px">
        <h2>✅ ¡Autorización exitosa!</h2>
        <p>Copia este token y guárdalo en <strong>Replit → Secrets</strong> como:</p>
        <p><code>GMAIL_REFRESH_TOKEN</code></p>
        <hr/>
        <p><strong>Tu refresh_token:</strong></p>
        <textarea style="width:100%;height:120px;font-size:12px;padding:8px">${refreshToken}</textarea>
        <hr/>
        <p>Después de guardar el secret, <strong>reinicia el servidor</strong> para activar el polling.</p>
        <p style="color:#888;font-size:12px">⚠️ No compartas este token con nadie.</p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`
      <html><body style="font-family:monospace;padding:2rem">
        <h2>❌ Error al obtener el token</h2>
        <p>${err instanceof Error ? err.message : String(err)}</p>
      </body></html>
    `);
  }
});

// ═════════════════════════════════════════════════════════
// DIAGNÓSTICO — Ver el texto del último correo que falló
// ═════════════════════════════════════════════════════════
router.get("/gmail/ultimo-fallido", (_req: Request, res: Response) => {
  const fallido = getUltimoCorreoFallido();
  if (!fallido) {
    res.json({ ok: true, mensaje: "No hay correos fallidos registrados" });
    return;
  }
  res.json({
    ok: true,
    id: fallido.id,
    asunto: fallido.asunto,
    texto: fallido.texto,
  });
});

// ═════════════════════════════════════════════════════════
// PAUSAR / REANUDAR POLLING
// ═════════════════════════════════════════════════════════
router.post("/gmail/pausar", (req: Request, res: Response) => {
  const { pausar } = req.body;

  if (typeof pausar !== "boolean") {
    res.status(400).json({ ok: false, mensaje: "Se requiere: { pausar: true } o { pausar: false }" });
    return;
  }

  if (pausar) {
    detenerGmailPolling();
    res.json({ ok: true, mensaje: "⏸️ Polling de Gmail pausado" });
  } else {
    iniciarGmailPolling();
    res.json({ ok: true, mensaje: "▶️ Polling de Gmail reanudado" });
  }
});

export default router;
