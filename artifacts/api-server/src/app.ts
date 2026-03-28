import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { iniciarTodosLosBots } from "./bot/bot-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
app.use("/public", express.static(PUBLIC_DIR));

app.use("/api", router);

// Iniciar todos los bots de los tenants activos
iniciarTodosLosBots().catch((err) => {
  console.error("❌ Error iniciando bots:", err);
});

export default app;
