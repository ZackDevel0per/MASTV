/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║      MANEJADOR DE FOTOS Y VIDEOS EN WHATSAPP             ║
 * ║   Envía medios (imágenes, videos) a través del bot       ║
 * ╚══════════════════════════════════════════════════════════╝
 */

import { getSock } from "./whatsapp.js";
import fs from "fs";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Envía una imagen a través de WhatsApp
 * @param telefono Número del cliente (con o sin @s.whatsapp.net)
 * @param url URL de la imagen (https://)
 * @param caption Pie de foto (opcional)
 */
export async function enviarImagen(
  telefono: string,
  url: string,
  caption?: string
) {
  const sock = getSock();
  if (!sock) throw new Error("Bot no conectado");

  const jid = telefono.includes("@s.whatsapp.net")
    ? telefono
    : `${telefono}@s.whatsapp.net`;

  await sock.sendMessage(jid, {
    image: { url },
    caption: caption || undefined,
  });
}

/**
 * Envía un video a través de WhatsApp
 * @param telefono Número del cliente
 * @param url URL del video (https://)
 * @param caption Pie de video (opcional)
 */
export async function enviarVideo(
  telefono: string,
  url: string,
  caption?: string
) {
  const sock = getSock();
  if (!sock) throw new Error("Bot no conectado");

  const jid = telefono.includes("@s.whatsapp.net")
    ? telefono
    : `${telefono}@s.whatsapp.net`;

  await sock.sendMessage(jid, {
    video: { url },
    caption: caption || undefined,
  });
}

/**
 * Envía un documento (PDF, ZIP, etc.)
 * @param telefono Número del cliente
 * @param url URL del documento
 * @param nombreArchivo Nombre que se verá en el chat
 */
export async function enviarDocumento(
  telefono: string,
  url: string,
  nombreArchivo: string
) {
  const sock = getSock();
  if (!sock) throw new Error("Bot no conectado");

  const jid = telefono.includes("@s.whatsapp.net")
    ? telefono
    : `${telefono}@s.whatsapp.net`;

  await sock.sendMessage(jid, {
    document: { url },
    fileName: nombreArchivo,
  });
}

/**
 * Envía múltiples medios en secuencia
 * Útil para enviar galería de fotos, videos, etc.
 */
export async function enviarMultiplesMedias(
  telefono: string,
  medias: Array<{
    tipo: "imagen" | "video" | "documento";
    url: string;
    caption?: string;
    nombre?: string;
  }>
) {
  for (const media of medias) {
    try {
      if (media.tipo === "imagen") {
        await enviarImagen(telefono, media.url, media.caption);
      } else if (media.tipo === "video") {
        await enviarVideo(telefono, media.url, media.caption);
      } else if (media.tipo === "documento") {
        await enviarDocumento(
          telefono,
          media.url,
          media.nombre || "documento"
        );
      }
      // Pequeño delay entre medios para no sobrecargar
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`Error enviando media ${media.tipo}:`, err);
    }
  }
}

/**
 * Envía una galería de imágenes (carrusel)
 * Las imágenes se envían como mensajes separados
 */
export async function enviarGaleria(
  telefono: string,
  imagenes: string[],
  captions?: string[]
) {
  const medias = imagenes.map((url, idx) => ({
    tipo: "imagen" as const,
    url,
    caption: captions?.[idx],
  }));
  await enviarMultiplesMedias(telefono, medias);
}
