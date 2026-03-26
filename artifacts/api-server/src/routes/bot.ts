import { Router, type IRouter, type Request, type Response } from "express";
import {
  procesarPago,
  getBotEstado,
  solicitarCodigoPareo,
  setBotActivo,
  enviarImagenPersonalizada,
  enviarVideoPersonalizado,
  enviarMensaje,
} from "../bot/whatsapp.js";
import { confirmarPago, marcarEntregado, buscarPedidoPorMonto } from "../bot/payment-store.js";
import { crearCuentaEnCRM, PLAN_ID_MAP, debugRenewPage } from "../bot/crm-service.js";
import { ACTIVACION_EXITOSA } from "../bot/responses.js";
import { registrarPagoYapeLocal, listarPagosYape } from "../bot/yape-store.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FOLDER = path.join(__dirname, "../../auth_info_baileys");

const router: IRouter = Router();

const TOKEN_SECRETO = process.env.TASKER_TOKEN || "cambia_este_token_seguro_2024";

// ═════════════════════════════════════════════════════════
// TASKER — DESACTIVADO
//
// Los endpoints de Tasker (/bot/pago y /bot/pago-qr) están
// desactivados porque el registro de pagos ahora lo hace el
// servicio de Gmail automáticamente.
//
// El código se conserva intacto para reactivarlo en el futuro
// si fuera necesario. Para reactivar: cambiar a false.
// ═════════════════════════════════════════════════════════
const TASKER_DESACTIVADO = true;

function verificarToken(req: Request, res: Response): boolean {
  const token = req.body?.token || req.query?.token || req.headers["x-bot-token"];
  if (token !== TOKEN_SECRETO) {
    res.status(401).json({ ok: false, mensaje: "Token de autenticación inválido" });
    return false;
  }
  return true;
}

// ═════════════════════════════════════════════════════════
// ESTADO DEL BOT
// ═════════════════════════════════════════════════════════
router.get("/bot/estado", (_req, res) => {
  const estado = getBotEstado();
  res.json({
    ok: true,
    ...estado,
    timestamp: new Date().toISOString(),
  });
});

// ═════════════════════════════════════════════════════════
// ACTIVAR / DESACTIVAR BOT
// ═════════════════════════════════════════════════════════
router.post("/bot/activar", (req, res) => {
  const { activo } = req.body;
  if (typeof activo !== "boolean") {
    res.status(400).json({
      ok: false,
      mensaje: "Se requiere: { activo: true } o { activo: false }",
    });
    return;
  }
  setBotActivo(activo);
  res.json({
    ok: true,
    mensaje: activo
      ? "✅ Bot ACTIVADO. Responde a todos los mensajes."
      : "⏸️ Bot DESACTIVADO. No responde mensajes.",
    botActivo: activo,
  });
});

// ═════════════════════════════════════════════════════════
// CÓDIGO DE PAREO (para conectar bot a WhatsApp)
// ═════════════════════════════════════════════════════════
router.post("/bot/codigo-pareo", async (req, res) => {
  const { telefono } = req.body;

  if (!telefono) {
    res.status(400).json({
      ok: false,
      mensaje: "Se requiere el campo 'telefono'. Ejemplo: 5215512345678",
    });
    return;
  }

  try {
    const codigo = await solicitarCodigoPareo(telefono);
    res.json({
      ok: true,
      codigo,
      instrucciones: `En tu WhatsApp ve a: Dispositivos vinculados → Vincular con número de teléfono → ingresa: ${codigo}`,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al solicitar código",
    });
  }
});

// ═════════════════════════════════════════════════════════
// ELIMINAR SESIÓN (resetear bot)
// ═════════════════════════════════════════════════════════
router.delete("/bot/sesion", (_req, res) => {
  try {
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    }
    res.json({
      ok: true,
      mensaje: "Sesión eliminada. Reinicia el servidor para generar nuevo QR o código.",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al eliminar sesión",
    });
  }
});

// ═════════════════════════════════════════════════════════
// PROCESAR PAGO (desde Tasker) — DESACTIVADO
//
// Tasker debe enviar: { token, telefono, monto }
// El servidor busca el pedido pendiente, valida el monto,
// crea la cuenta en el CRM y envía las credenciales.
//
// Modo legacy (backward compat): si vienen usuario y contrasena,
// simplemente reenvía las credenciales sin crear cuenta nueva.
//
// NOTA: Desactivado. Los pagos ahora se registran via Gmail.
// Para reactivar: cambiar TASKER_DESACTIVADO a false en este archivo.
// ═════════════════════════════════════════════════════════
router.post("/bot/pago", async (req, res) => {
  if (TASKER_DESACTIVADO) {
    res.status(503).json({
      ok: false,
      mensaje: "Este endpoint está desactivado. Los pagos ahora se detectan automáticamente via Gmail.",
    });
    return;
  }
  if (!verificarToken(req, res)) return;

  const { telefono, monto, nombreCliente, usuario, contrasena, plan, fecha } = req.body;

  if (!telefono) {
    res.status(400).json({ ok: false, mensaje: "Se requiere el campo 'telefono'" });
    return;
  }

  // ── Modo legacy: si vienen usuario y contrasena, enviar directo ──
  if (usuario && contrasena) {
    try {
      const resultado = await procesarPago({ nombreCliente: nombreCliente || telefono, telefono, usuario, contrasena, plan, monto, fecha });
      res.json(resultado);
    } catch (error) {
      res.status(500).json({ ok: false, mensaje: error instanceof Error ? error.message : "Error interno" });
    }
    return;
  }

  // ── Modo automático: Tasker envía solo teléfono + monto ──────────
  if (monto === undefined || monto === null) {
    res.status(400).json({ ok: false, mensaje: "Se requiere el campo 'monto'" });
    return;
  }

  const montoNum = parseFloat(String(monto));
  if (isNaN(montoNum)) {
    res.status(400).json({ ok: false, mensaje: "El campo 'monto' debe ser numérico" });
    return;
  }

  try {
    // 1. Confirmar pago en el store
    const pedido = confirmarPago(telefono, montoNum);
    if (!pedido) {
      res.status(404).json({
        ok: false,
        mensaje: `No hay pedido pendiente para ${telefono} o el monto no coincide`,
      });
      return;
    }

    // 2. Crear cuenta en CRM
    const planInfo = PLAN_ID_MAP[pedido.plan];
    console.log(`🚀 [TASKER] Creando cuenta para ${telefono} → plan ${pedido.plan}`);
    const resultado = await crearCuentaEnCRM(
      pedido.plan,
      `Cliente_${telefono}`,
      `${telefono}@zktv.bo`,
      telefono
    );

    if (!resultado.ok || !resultado.usuario) {
      res.status(500).json({ ok: false, mensaje: `Error creando cuenta CRM: ${resultado.mensaje}` });
      return;
    }

    // 3. Enviar credenciales al cliente por WhatsApp
    const mensajeActivacion = ACTIVACION_EXITOSA({
      usuario: resultado.usuario,
      contrasena: resultado.contrasena ?? "",
      plan: resultado.plan ?? planInfo?.nombre ?? pedido.plan,
      servidor: resultado.servidor,
    });
    await enviarMensaje(telefono, mensajeActivacion);
    marcarEntregado(telefono, resultado.usuario);

    console.log(`✅ [TASKER] Cuenta entregada a ${telefono}: ${resultado.usuario}`);
    res.json({
      ok: true,
      mensaje: "Pago confirmado, cuenta creada y credenciales enviadas",
      telefono,
      usuario: resultado.usuario,
      plan: pedido.plan,
    });
  } catch (error) {
    console.error("Error procesando pago automático:", error);
    res.status(500).json({
      ok: false,
      mensaje: error instanceof Error ? error.message : "Error interno del servidor",
    });
  }
});

// ═════════════════════════════════════════════════════════
// PAGO VIA NOTIFICACION YAPE/QR (Tasker lee la notificación) — DESACTIVADO
// ═════════════════════════════════════════════════════════
// Tasker envía el texto completo de la notificación:
//   { token, notificacion: "QR DE NOMBRE te enviò Bs. 29.00" }
//   ó los campos separados: { token, nombre: "NOMBRE", monto: 29.00 }
//
// El servidor guarda el pago en Google Sheets (Nombre + Monto + Usado=NO).
// La activación ocurre después cuando el cliente escribe VERIFICAR en WhatsApp
// y confirma su nombre exacto y monto exacto.
//
// NOTA: Desactivado. Los pagos ahora se registran via Gmail.
// Para reactivar: cambiar TASKER_DESACTIVADO a false en este archivo.
// ═════════════════════════════════════════════════════════
router.post("/bot/pago-qr", async (req, res) => {
  if (TASKER_DESACTIVADO) {
    res.status(503).json({
      ok: false,
      mensaje: "Este endpoint está desactivado. Los pagos ahora se detectan automáticamente via Gmail.",
    });
    return;
  }
  if (!verificarToken(req, res)) return;

  let nombre: string | undefined;
  let montoNum: number | undefined;

  const { notificacion, monto } = req.body;

  if (notificacion) {
    // Parsear texto: "QR DE NOMBRE te enviò Bs. 29.00"
    const matchNombre = String(notificacion).match(/QR\s+DE\s+(.+?)\s+te\s+envi/i);
    const matchMonto = String(notificacion).match(/Bs\.\s*([\d.,]+)/i);
    if (!matchNombre || !matchMonto) {
      res.status(400).json({
        ok: false,
        mensaje: 'Formato no reconocido. Esperado: "QR DE NOMBRE te enviò Bs. MONTO"',
        notificacion,
      });
      return;
    }
    nombre = matchNombre[1]!.trim().toUpperCase();
    montoNum = parseFloat(matchMonto[1]!.replace(",", "."));
  } else {
    nombre = req.body.nombre ? String(req.body.nombre).trim().toUpperCase() : undefined;
    montoNum = monto !== undefined ? parseFloat(String(monto)) : undefined;
  }

  if (!nombre) {
    res.status(400).json({ ok: false, mensaje: "No se pudo extraer el nombre del pagador" });
    return;
  }

  if (montoNum === undefined || isNaN(montoNum)) {
    res.status(400).json({ ok: false, mensaje: "No se pudo extraer el monto del pago" });
    return;
  }

  console.log(`📲 [TASKER] Notificación recibida: ${nombre} → Bs. ${montoNum}`);

  try {
    registrarPagoYapeLocal(nombre, montoNum);
    res.json({
      ok: true,
      mensaje: "Pago registrado. El cliente debe escribir VERIFICAR en WhatsApp.",
      nombre,
      monto: montoNum,
    });
  } catch (error) {
    console.error("Error registrando pago:", error);
    res.status(500).json({
      ok: false,
      mensaje: error instanceof Error ? error.message : "Error al registrar el pago",
    });
  }
});

// ═════════════════════════════════════════════════════════
// DEBUG: Ver pagos registrados en memoria (solo desarrollo)
// ═════════════════════════════════════════════════════════
router.get("/bot/pagos-yape", (req, res) => {
  if (!verificarToken(req, res)) return;
  const pagos = listarPagosYape();
  res.json({ ok: true, total: pagos.length, pagos });
});

// ═════════════════════════════════════════════════════════
// ENVIAR MENSAJE PERSONALIZADO
// ═════════════════════════════════════════════════════════
router.post("/bot/mensaje", async (req, res) => {
  if (!verificarToken(req, res)) return;

  const { telefono, mensaje } = req.body;

  if (!telefono || !mensaje) {
    res.status(400).json({
      ok: false,
      mensaje: "Se requiere: telefono y mensaje",
    });
    return;
  }

  try {
    await enviarMensaje(telefono, mensaje);
    res.json({
      ok: true,
      mensaje: "Mensaje enviado correctamente",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al enviar mensaje",
    });
  }
});

// ═════════════════════════════════════════════════════════
// ENVIAR IMAGEN
// ═════════════════════════════════════════════════════════
router.post("/bot/imagen", async (req, res) => {
  if (!verificarToken(req, res)) return;

  const { telefono, url, pie } = req.body;

  if (!telefono || !url) {
    res.status(400).json({
      ok: false,
      mensaje: "Se requiere: telefono y url (HTTPS)",
    });
    return;
  }

  if (!url.startsWith("https://")) {
    res.status(400).json({
      ok: false,
      mensaje: "La URL debe comenzar con https://",
    });
    return;
  }

  try {
    const resultado = await enviarImagenPersonalizada(telefono, url, pie);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al enviar imagen",
    });
  }
});

// ═════════════════════════════════════════════════════════
// ENVIAR VIDEO
// ═════════════════════════════════════════════════════════
router.post("/bot/video", async (req, res) => {
  if (!verificarToken(req, res)) return;

  const { telefono, url, pie } = req.body;

  if (!telefono || !url) {
    res.status(400).json({
      ok: false,
      mensaje: "Se requiere: telefono y url (HTTPS)",
    });
    return;
  }

  if (!url.startsWith("https://")) {
    res.status(400).json({
      ok: false,
      mensaje: "La URL debe comenzar con https://",
    });
    return;
  }

  try {
    const resultado = await enviarVideoPersonalizado(telefono, url, pie);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al enviar video",
    });
  }
});

// ═════════════════════════════════════════════════════════
// DEBUG: inspeccionar página renew-with-package sin cambios
// ═════════════════════════════════════════════════════════
router.get("/debug-renew/:username", async (req: Request, res: Response) => {
  try {
    const data = await debugRenewPage(req.params.username as string);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═════════════════════════════════════════════════════════
// PING (para UptimeRobot)
// ═════════════════════════════════════════════════════════
router.get("/ping", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
