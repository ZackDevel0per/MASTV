/**
 * Rutas para gestionar la integración con Gmail.
 *
 * Endpoints:
 *   GET  /api/gmail/estado      — Ver si Gmail está activo y configurado
 *   GET  /api/gmail/autorizar   — Obtener la URL de autorización (visitar una vez)
 *   GET  /api/gmail/callback    — Recibe el código OAuth2 y muestra el refresh_token
 *   POST /api/gmail/pausar      — Pausar/reanudar el polling
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  getGmailEstado,
  generarUrlAutorizacion,
  intercambiarCodigo,
  iniciarGmailPolling,
  detenerGmailPolling,
} from "../bot/gmail-service.js";

const router: IRouter = Router();

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
    const host = req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost";
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const redirectUri = `${proto}://${host}/api/gmail/callback`;

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
// CALLBACK OAuth2 — Recibe el code y devuelve el refresh_token
// ═════════════════════════════════════════════════════════
router.get("/gmail/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  const error = req.query["error"] as string | undefined;

  if (error) {
    res.status(400).send(`
      <html><body style="font-family:monospace;padding:2rem">
        <h2>❌ Autorización rechazada</h2>
        <p>Error: ${error}</p>
        <p>Vuelve a intentarlo desde <code>/api/gmail/autorizar</code></p>
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

  try {
    const host = req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost";
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const redirectUri = `${proto}://${host}/api/gmail/callback`;

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
