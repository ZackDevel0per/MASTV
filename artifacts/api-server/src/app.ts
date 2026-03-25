import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { conectarBot } from "./bot/whatsapp.js";
import { inicializarHojas } from "./bot/sheets.js";
import { iniciarGmailPolling } from "./bot/gmail-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir videos e imágenes estáticas
app.use("/public", express.static(path.join(__dirname, "../../public")));

app.use("/api", router);

async function iniciarBot() {
  try {
    console.log("📊 Inicializando hojas de Google Sheets...");
    await inicializarHojas();
    console.log("✅ Hojas de Google Sheets listas.");
  } catch (err) {
    console.error("⚠️ Error al inicializar Google Sheets:", err);
  }

  try {
    console.log("🤖 Iniciando bot de WhatsApp...");
    await conectarBot();
  } catch (err) {
    console.error("❌ Error al iniciar el bot:", err);
  }

  // Iniciar polling de Gmail (solo arranca si las credenciales están configuradas)
  iniciarGmailPolling();
}

iniciarBot();

export default app;
