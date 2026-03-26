/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║      RESPUESTAS PERSONALIZADAS DEL BOT - EDITABLE        ║
 * ║    Modifica aquí todos los mensajes del bot sin           ║
 * ║    tocar la lógica. Puedes agregar fotos, videos, etc.    ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * DONDE EDITAR PLANES:
 * 1. Todos los textos de planes están aquí (responses.ts)
 * 2. Los precios y información están en: src/bot/planes.ts
 * 3. Para reiniciar sin desconectar: Solo reinicia el workflow desde Replit
 */

/**
 * Tipos de respuesta:
 * - text: Mensaje de texto simple
 * - image: Foto/imagen
 * - video: Video
 * - document: Archivo
 */

export interface RespuestaMedia {
  tipo: "text" | "image" | "video" | "document";
  contenido: string;
  caption?: string;
}

export interface RespuestaBot {
  tipo: RespuestaMedia["tipo"][];
  contenido: (RespuestaMedia | string)[];
}

// ═══════════════════════════════════════════════════════════
// SALUDO INICIAL
// ═══════════════════════════════════════════════════════════
export const SALUDO_INICIAL = `👋 *¡Hola! Bienvenido a ZKTV*

Somos tu mejor opción en entretenimiento en línea.

📺 *¿Qué quieres hacer?*

*1️⃣* → Ver planes disponibles
*2️⃣* → Conocer nuestras características
*3️⃣* → Soporte técnico
*4️⃣* → Activar mi servicio
*5️⃣* → 🎁 Probar gratis el servicio
*6️⃣* → 📹 Guías de instalación
*7️⃣* → 📅 Ver días restantes de mi cuenta
*VERIFICAR* → 🔍 Ver mis cuentas activas

_Escribe el número que prefieres_ ⬇️`;

// ═══════════════════════════════════════════════════════════
// RESPUESTAS POR NÚMERO/LETRA
// ═══════════════════════════════════════════════════════════

export const RESPUESTAS_NUMEROS: Record<string, RespuestaMedia[]> = {
  // ═══════════════════════════════════════════════════════════
  // OPCIÓN 5: PROBAR GRATIS
  // ═══════════════════════════════════════════════════════════
  "5": [
    {
      tipo: "text",
      contenido: `🎁 *Prueba ZKTV GRATIS*

Puedes probar nuestro servicio sin costo. Elige la duración de tu demo:

*DEMO1* → Prueba de *1 hora* (completa)
*DEMO3* → Prueba de *3 horas* (completa)

_Solo escribe la opción y ¡listo! Recibirás tus credenciales al instante._ ⚡

*MENU* → Volver al menú principal`,
    },
  ],

  DEMO1: [
    { tipo: "text", contenido: "⏳ _Creando tu cuenta demo de 1 hora..._" },
  ],
  DEMO3: [
    { tipo: "text", contenido: "⏳ _Creando tu cuenta demo de 3 horas..._" },
  ],

  // ═══════════════════════════════════════════════════════════
  // OPCIÓN 1: PLANES
  // ═══════════════════════════════════════════════════════════
  "1": [
    {
      tipo: "text",
      contenido: `📱 *¿Para cuántos dispositivos requiere el servicio?*

*P* → 1 dispositivo
*Q* → 2 dispositivos
*R* → 3 dispositivos

_Selecciona la opción que necesitas_`,
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // PLANES 1 DISPOSITIVO (Letra P)
  // ═══════════════════════════════════════════════════════════
  P: [
    {
      tipo: "text",
      contenido: `📺 *Planes - 1 Dispositivo*

💰 *1 MES* → Bs 29
💰 *3 MESES* → Bs 82
💰 *6 MESES* → Bs 155 (+1 mes gratis = 7 meses)
💰 *12 MESES* → Bs 300 (+2 meses gratis = 14 meses)

*P1* → Contratar 1 mes (Bs 29)
*P2* → Contratar 3 meses (Bs 82)
*P3* → Contratar 6 meses (Bs 155)
*P4* → Contratar 12 meses (Bs 300)`,
    },
  ],

  P1: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 1 Dispositivo - 1 Mes*
💰 Bs 29

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 29* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  P2: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 1 Dispositivo - 3 Meses*
💰 Bs 82

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 82* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  P3: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 1 Dispositivo - 6 Meses*
💰 Bs 155 🎁 +1 mes gratis (Total: 7 meses)

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 155* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  P4: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 1 Dispositivo - 12 Meses*
💰 Bs 300 🎁 +2 meses gratis (Total: 14 meses)

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 300* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // PLANES 2 DISPOSITIVOS (Letra Q)
  // ═══════════════════════════════════════════════════════════
  Q: [
    {
      tipo: "text",
      contenido: `📺 *Planes - 2 Dispositivos*

💰 *1 MES* → Bs 35
💰 *3 MESES* → Bs 100
💰 *6 MESES* → Bs 190 (+1 mes gratis = 7 meses)
💰 *12 MESES* → Bs 380 (+2 meses gratis = 14 meses)

*Q1* → Contratar 1 mes (Bs 35)
*Q2* → Contratar 3 meses (Bs 100)
*Q3* → Contratar 6 meses (Bs 190)
*Q4* → Contratar 12 meses (Bs 380)`,
    },
  ],

  Q1: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 2 Dispositivos - 1 Mes*
💰 Bs 35

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 35* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  Q2: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 2 Dispositivos - 3 Meses*
💰 Bs 100

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 100* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  Q3: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 2 Dispositivos - 6 Meses*
💰 Bs 190 🎁 +1 mes gratis (Total: 7 meses)

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 190* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  Q4: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 2 Dispositivos - 12 Meses*
💰 Bs 380 🎁 +2 meses gratis (Total: 14 meses)

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 380* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // PLANES 3 DISPOSITIVOS (Letra R)
  // ═══════════════════════════════════════════════════════════
  R: [
    {
      tipo: "text",
      contenido: `📺 *Planes - 3 Dispositivos*

💰 *1 MES* → Bs 40
💰 *3 MESES* → Bs 115
💰 *6 MESES* → Bs 225 (+1 mes gratis = 7 meses)
💰 *12 MESES* → Bs 440 (+2 meses gratis = 14 meses)

*R1* → Contratar 1 mes (Bs 40)
*R2* → Contratar 3 meses (Bs 115)
*R3* → Contratar 6 meses (Bs 225)
*R4* → Contratar 12 meses (Bs 440)`,
    },
  ],

  R1: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 3 Dispositivos - 1 Mes*
💰 Bs 40

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 40* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  R2: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 3 Dispositivos - 3 Meses*
💰 Bs 115

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 115* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  R3: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 3 Dispositivos - 6 Meses*
💰 Bs 225 🎁 +1 mes gratis (Total: 7 meses)

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 225* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  R4: [
    {
      tipo: "text",
      contenido: `✅ *Plan Seleccionado: 3 Dispositivos - 12 Meses*
💰 Bs 440 🎁 +2 meses gratis (Total: 14 meses)

Para completar tu activación:
1️⃣ Realiza tu pago de *Bs 440* por Yape o QR
2️⃣ Cuando termines, escribe *COMPROBAR*
3️⃣ El bot te pedirá tu nombre y el monto exacto
4️⃣ ¡Recibirás tus credenciales al instante!

⚠️ _El nombre debe ser exactamente como aparece en tu comprobante_

*COMPROBAR* → Confirmar mi pago
*1* → Volver al menú`,
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // OTRAS OPCIONES
  // ═══════════════════════════════════════════════════════════
  "2": [
    {
      tipo: "text",
      contenido: `✨ *¿Por qué elegirnos?*

✅ Streaming sin interrupciones
✅ Señal HD, FHD y 4K disponible
✅ Miles de películas, series y canales en vivo
✅ Acceso desde cualquier dispositivo
✅ Múltiples dispositivos simultáneamente
✅ Pago seguro y rápido
✅ Atención al cliente 24/7

_¡Contrata y obtén el mejor servicio de TV en Bolivia!_ 🏆

🎁 *¿Quieres probarlo gratis?*
*DEMO1* → Demo de 1 hora
*DEMO3* → Demo de 3 horas

*MENU* → Volver al menú principal`,
    },
  ],

  "3": [
    {
      tipo: "text",
      contenido: `🆘 *Centro de Soporte ZKTV*

📞 Teléfono: *+591 69741630*
💬 WhatsApp: *+591 69741630*
🕐 Atención: 24/7

─────────────────────
🔧 *Comandos de soporte:*

*ERRORES* → Ver errores comunes y soluciones

─────────────────────
*MENU* → Volver al menú principal`,
    },
  ],

  "4": [
    {
      tipo: "text",
      contenido: `🔐 *Activar tu Servicio*

Ya tienes una cuenta registrada. 

💰 Para activarla necesitas realizar un pago.

_¿Ya realizaste tu pago?_

Cuando hayas pagado, escribe *COMPROBAR* y recibirás tus credenciales al instante.

*MENU* → Volver al menú principal`,
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // OPCIÓN 6: GUÍAS DE INSTALACIÓN
  // ═══════════════════════════════════════════════════════════
  "6": [
    {
      tipo: "text",
      contenido: `📹 *Guías de Instalación ZKTV*

Selecciona tu dispositivo:

*61* → 📺 Smart TV (LG / Samsung)
*62* → 📦 Android TV Box / Android TV / TV Stick / Google TV
*63* → 📱 Celular o Tablet Android
*64* → 🍎 iPhone / iPad / Mac / MacBook
*65* → 💻 PC / Windows
*66* → 🌐 Instalar por Navegador (alternativa Android)

*MENU* → Volver al menú principal`,
    },
  ],

  // ── 61: Smart TV → sub-menú LG / Samsung ──
  "61": [
    {
      tipo: "text",
      contenido: `📺 *Instalación en Smart TV*

Elige tu marca:

*611* → 🟥 LG
*612* → 🔵 Samsung

*6* → Volver a guías
*MENU* → Menú principal`,
    },
  ],

  "611": [
    {
      tipo: "video",
      contenido: "LGTUTORIAL",
      caption: `🟥 *Instalación en Smart TV LG*\n\nSigue los pasos del video.\n\n¿Necesitas ayuda? Escribe *3* para soporte.\n*61* → Volver`,
    },
  ],

  "612": [
    {
      tipo: "video",
      contenido: "SAMSUNGTUTORIAL",
      caption: `🔵 *Instalación en Smart TV Samsung*\n\nSigue los pasos del video.\n\n¿Necesitas ayuda? Escribe *3* para soporte.\n*61* → Volver`,
    },
  ],

  // ── 62: Android TV Box / TV Stick / Google TV ──
  "62": [
    {
      tipo: "video",
      contenido: "ANDROIDTV",
      caption: `📦 *Instalación en Android TV Box / Android TV / TV Stick / Google TV*`,
    },
    {
      tipo: "text",
      contenido: `📲 *Pasos de instalación:*

Descarga desde tu dispositivo, desde la *Play Store*, la aplicación *Downloader* (como se ve en el video).

Una vez abierta, introduce el siguiente código:

*223062*

y presiona *Go*. Se descargará e instalará la app automáticamente.

💡 Si Downloader falla en tu dispositivo, escribe *66* para ver la instalación por navegador.

*6* → Volver a guías
*MENU* → Menú principal`,
    },
  ],

  // ── 63: Celular / Tablet Android ──
  "63": [
    {
      tipo: "text",
      contenido: `📱 *CÓMO INSTALAR EN CELULAR O TABLET*

⚠️ *NO está en Play Store*

Descarga la app desde este link:
👉 *bit.ly/mastviptv*

Al descargar presiona *"Descargar de todos modos"* y luego instálala. Si aparece una advertencia, elige *"Más detalles"* → *"Instalar de todos modos"*.

─────────────────────
✅ Si ya instalaste la app, puedes solicitar tu prueba gratuita escribiendo *5* y eligiendo:

*DEMO1* → Demo de 1 hora
*DEMO3* → Demo de 3 horas

*6* → Volver a guías
*MENU* → Menú principal`,
    },
  ],

  // ── 64: iPhone / iPad / Mac / MacBook ──
  "64": [
    {
      tipo: "video",
      contenido: "APPLE",
      caption: `🍎 *Instalación en iPhone / iPad / Mac / MacBook*`,
    },
    {
      tipo: "text",
      contenido: `🍎 *Pasos de instalación:*

Ve a la *App Store* y busca *SMARTERS PLAYER LITE*, o presiona este link para ir directo:
👉 *https://bit.ly/smarters-iphone*

Instálala, ábrela, acepta los términos y elige *"Xtream Code"*.

─────────────────────
✅ Cuando estés en la ventana principal de IPTV Smarters, puedes solicitar tu prueba gratuita escribiendo *5* y eligiendo:

*DEMO1* → Demo de 1 hora
*DEMO3* → Demo de 3 horas

🌐 *URL del servidor:* http://mtv.bo:80

*6* → Volver a guías
*MENU* → Menú principal`,
    },
  ],

  // ── 65: PC / Windows ──
  "65": [
    {
      tipo: "video",
      contenido: "PCTUTORIAL",
      caption: `💻 *Instalación en PC / Windows*`,
    },
    {
      tipo: "text",
      contenido: `💻 *Pasos de instalación:*

Haz click en este enlace desde tu computadora para instalar *FULLTVMAS*:
👉 *https://bit.ly/mastvpc*

Descárgalo e instálalo. Si aparece una advertencia de Windows:
➡️ Presiona *"Más información"* → *"Ejecutar de todas formas"*
➡️ Siguiente → Siguiente → Se instalará.

─────────────────────
✅ Si ya tienes la app, escribe *5* para solicitar tu prueba gratuita:

*DEMO1* → Demo de 1 hora
*DEMO3* → Demo de 3 horas

*6* → Volver a guías
*MENU* → Menú principal`,
    },
  ],

  // ── 66: Instalación por Navegador (alternativa Android) ──
  "66": [
    {
      tipo: "text",
      contenido: `🌐 *Instalar por Navegador (si falla Downloader)*

Puedes usar cualquier navegador que tenga tu dispositivo Android.

Abre el navegador e ingresa:
👉 *bit.ly/mastviptv*

Sirve para:
✅ Android TV
✅ TV Box
✅ TV Stick
✅ Google TV

─────────────────────
✅ Si lograste instalar la app, escribe *5* para solicitar tu prueba gratuita:

*DEMO1* → Demo de 1 hora
*DEMO3* → Demo de 3 horas

*6* → Volver a guías
*MENU* → Menú principal`,
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// RESPUESTA POR DEFECTO
// ═══════════════════════════════════════════════════════════
export const RESPUESTA_DESCONOCIDA = `❓ No entendí ese mensaje.

Escribe uno de estos números:
*1* → Ver planes
*2* → Características
*3* → Soporte
*4* → Activar servicio
*5* → Probar gratis
*6* → Guías de instalación
*7* → Ver días restantes de mi cuenta

O escribe *MENU* para volver al menú principal.`;

// ═══════════════════════════════════════════════════════════
// RESPUESTA AL ACTIVAR LA CUENTA
// ═══════════════════════════════════════════════════════════
export const ACTIVACION_EXITOSA = (datos: {
  usuario: string;
  contrasena: string;
  plan?: string;
  servidor?: string;
}) => `
🎉 *¡Tu cuenta está ACTIVA!*

🎬 *Bienvenido a ZKTV*

🔐 *Credenciales de acceso:*
📛 Nombre: \`mastv\`
👤 Usuario: \`${datos.usuario}\`
🔑 Contraseña: \`${datos.contrasena}\`
🌐 URL: \`${datos.servidor || "http://mtv.bo:80"}\`

📺 *Plan contratado:* ${datos.plan || "Plan Activo"}

_Puedes acceder desde la web, Smart TV o app mobile_

¿Necesitas ayuda? Escribe *3* para soporte.
`;

// ═══════════════════════════════════════════════════════════
// COMANDOS ESPECIALES
// ═══════════════════════════════════════════════════════════
export const COMANDOS_ESPECIALES: Record<string, RespuestaMedia[]> = {
  AYUDA: [
    {
      tipo: "text",
      contenido: `📋 *Comandos disponibles:*

*Menú Principal:*
*1* → Ver planes
*2* → Características
*3* → Soporte
*4* → Activar
*5* → Probar gratis
*6* → Guías de instalación

*Seleccionar dispositivos:*
*P* → 1 dispositivo
*Q* → 2 dispositivos
*R* → 3 dispositivos

*Planes (1 dispositivo):*
*P1, P2, P3, P4*

*Planes (2 dispositivos):*
*Q1, Q2, Q3, Q4*

*Planes (3 dispositivos):*
*R1, R2, R3, R4*

*Demos gratuitas:*
*DEMO1* → Demo de 1 hora
*DEMO3* → Demo de 3 horas

*Soporte técnico:*
*ERRORES* → Ver errores comunes

*Otros:*
*HOLA / MENU* → Volver al inicio
*AYUDA* → Ver esto
*ESTADO* → Ver mi cuenta`,
    },
  ],

  ESTADO: [
    {
      tipo: "text",
      contenido: `📊 *Estado de tu Cuenta*

Tu cuenta está en el sistema.

_Para activarla necesitas:_
💰 Realizar un pago
✅ Recibir validación automática
🔓 Obtener credenciales

_Una vez realizado el pago, escribe:_ *COMPROBAR*

*MENU* → Volver al menú principal`,
    },
  ],

  HOLA: [
    {
      tipo: "text",
      contenido: SALUDO_INICIAL,
    },
  ],

  MENU: [
    {
      tipo: "text",
      contenido: SALUDO_INICIAL,
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // SOPORTE TÉCNICO - ERRORES COMUNES
  // ═══════════════════════════════════════════════════════════
  ERRORES: [
    {
      tipo: "text",
      contenido: `🔧 *Errores Comunes - Soporte Técnico*

Selecciona el problema que estás teniendo:

*ERR1* → 📶 La transmisión se corta o va lenta

_Se irán agregando más soluciones pronto._

─────────────────────
*3* → Volver a soporte
*MENU* → Volver al menú principal`,
    },
  ],

  ERR1: [
    {
      tipo: "text",
      contenido: `📶 *La transmisión se corta o va lenta*

Esto suele ocurrir por la velocidad de tu internet.

✅ La velocidad mínima recomendada es de *15 Mbps*.

🌐 Puedes revisar tu velocidad en:
*www.fast.com*

─────────────────────
💡 *Si tu internet supera los 15 Mbps y el problema persiste*, contáctanos directamente:

📞 *+591 69741630*
💬 WhatsApp: *+591 69741630*
🕐 Atención 24/7

─────────────────────
*ERRORES* → Ver más errores comunes
*3* → Volver a soporte
*MENU* → Volver al menú principal`,
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// PALABRAS CLAVE PARA SALUDOS
// ═══════════════════════════════════════════════════════════
export const PALABRAS_SALUDO = [
  "HOLA",
  "HI",
  "BUENOS",
  "BUENOS DÍAS",
  "BUENOS DÍAs",
  "BUENOS DIAS",
  "BUENAS",
  "BUENAS NOCHES",
  "BUENAS TARDES",
  "BUENA NOCHE",
  "BUENA TARDE",
  "BUEN DÍA",
  "BUEN DIA",
  "HOLA BUENOS",
  "INICIO",
  "START",
  "HELP",
  "INFORMACIÓN",
  "INFORMACION",
  "QUIERO INFORMACIÓN",
  "QUIERO INFORMACION",
  "MÁS INFORMACIÓN",
  "MAS INFORMACION",
  "DAME INFO",
  "¿CUÁLES SON LOS PLANES?",
  "CUALES SON LOS PLANES",
  "QUE OFRECES",
  "QUE PLANES TIENES",
  "PLANES",
  "CONTRATAR",
  "QUIERO CONTRATAR",
  "QUIERO SUSCRIBIRME",
  "SUSCRIPCIÓN",
  "SUSCRIPCION",
  "SUBSCRIBE",
  "PRECIO",
  "PRECIOS",
  "COSTO",
  "CUÁNTO CUESTA",
  "CUANTO CUESTA",
  "VALOR",
  "🤖",
];

/**
 * Reemplaza las variables {{variable}} en un mensaje con valores reales.
 */
export function formatearMensaje(
  plantilla: string,
  vars: Record<string, string | undefined>,
): string {
  return plantilla.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}
