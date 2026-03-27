import https from "https";
import querystring from "querystring";

const APP_TOKEN = process.env["PUSHOVER_APP_TOKEN"];
const USER_KEY = process.env["PUSHOVER_USER_KEY"];

/**
 * Sends a Pushover notification. When tapped, it opens the WhatsApp chat
 * with the given phone number using the wa.me deep link.
 */
export async function enviarNotificacionPushover(params: {
  titulo: string;
  mensaje: string;
  telefono?: string;
}): Promise<void> {
  if (!APP_TOKEN || !USER_KEY) {
    console.warn("[PUSHOVER] Credenciales no configuradas. Saltando notificación.");
    return;
  }

  const url = params.telefono
    ? `whatsappbusiness://send?phone=${params.telefono.replace(/\D/g, "")}`
    : undefined;

  const payload: Record<string, string> = {
    token: APP_TOKEN,
    user: USER_KEY,
    title: params.titulo,
    message: params.mensaje,
    sound: "pushover",
    priority: "0",
  };

  if (url) {
    payload["url"] = url;
    payload["url_title"] = "Abrir chat en WhatsApp";
  }

  const body = querystring.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.pushover.net",
        path: "/1/messages.json",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log("[PUSHOVER] Notificación enviada correctamente.");
            resolve();
          } else {
            console.error(`[PUSHOVER] Error HTTP ${res.statusCode}: ${data}`);
            resolve();
          }
        });
      },
    );
    req.on("error", (err) => {
      console.error("[PUSHOVER] Error de red:", err.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}
