/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         ARCHIVO DE MENSAJES DEL BOT - EDITABLE          ║
 * ║  Cambia aquí cualquier texto sin tocar la lógica del bot ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Puedes usar estas variables dentro de los mensajes:
 *   {{titular}}     → nombre del titular del cliente
 *   {{telefono}}    → número de teléfono del cliente
 *   {{recibo}}      → nombre del recibo registrado
 *   {{usuario}}     → usuario de acceso enviado
 *   {{contrasena}}  → contraseña de acceso enviada
 *   {{monto}}       → monto del pago
 *   {{plan}}        → nombre del plan adquirido
 */

export const MENSAJES = {

  // ─── BIENVENIDA ────────────────────────────────────────────
  bienvenida: `👋 *¡Bienvenido!*

Soy el asistente automático de activación de servicios.

📋 *¿Qué puedo hacer?*
• Escribe *103* para adquirir el servicio mensual
• Escribe *AYUDA* para ver todas las opciones
• Escribe *ESTADO* para verificar tu cuenta`,

  ayuda: `ℹ️ *Comandos disponibles:*

*103* → Adquirir servicio mensual
*ESTADO* → Ver estado de tu cuenta
*REINICIAR* → Volver al inicio

_Ante cualquier duda escríbenos directamente._`,

  // ─── REGISTRO ──────────────────────────────────────────────
  pedirTitular: `📝 *Registro de servicio*

Para continuar necesito algunos datos.

👤 ¿Cuál es el *nombre completo del titular*?`,

  pedirRecibo: `✅ Titular: *{{titular}}*

🧾 Ahora dime el *nombre exacto del recibo* tal como aparece en tu comprobante de pago:`,

  registroExitoso: `✅ *¡Datos registrados correctamente!*

📱 Teléfono: {{telefono}}
👤 Titular: {{titular}}
🧾 Recibo: *{{recibo}}*
💰 Plan: {{plan}}

Cuando realices el pago, recibirás tus credenciales automáticamente. 🔐

_¿Ya pagaste? El sistema valida en segundos._`,

  errorRegistro: `❌ Ocurrió un error al guardar tus datos.
Por favor escribe *REINICIAR* e intenta de nuevo.`,

  // ─── ESTADO DE CUENTA ──────────────────────────────────────
  cuentaPendiente: `⏳ *Tu cuenta está pendiente de pago*

🧾 Recibo registrado: *{{recibo}}*

Realiza tu pago y lo activaremos automáticamente.
_Si ya pagaste, espera unos minutos._`,

  cuentaActiva: `🎉 *¡Tu cuenta está ACTIVA!*

Titular: {{titular}}
Recibo: {{recibo}}

¡Disfruta el servicio! Si necesitas ayuda escríbenos.`,

  // ─── PAGO EXITOSO (se envía al activar la cuenta) ──────────
  pagoAprobado: `🎉 *¡Pago verificado y cuenta activada!*

👤 Titular: {{titular}}

🔐 *Tus credenciales de acceso:*
• Usuario: \`{{usuario}}\`
• Contraseña: \`{{contrasena}}\`

{{mensajePersonalizado}}

Si tienes dudas, escríbenos aquí mismo. ✅`,

  // ─── PAGO INCORRECTO ───────────────────────────────────────
  montoIncorrecto: `⚠️ *Pago recibido pero el monto no coincide*

💰 Monto recibido: Bs {{montoRecibido}}
💰 Monto esperado: Bs {{montoEsperado}}

Por favor realiza un nuevo pago por el monto correcto o contáctanos para resolver.`,

  pagoYaActivo: `ℹ️ Tu cuenta con el recibo *{{recibo}}* ya está activa.

Si tienes problemas para acceder, escríbenos.`,

  clienteNoEncontrado: `❌ No encontramos ningún registro con ese nombre de recibo.

Asegúrate de haberte registrado primero. Escribe *HOLA* para iniciar el registro.`,

  // ─── MENSAJES GENERALES ────────────────────────────────────
  comandoNoReconocido: `No entendí ese mensaje. 🤔

Escribe *AYUDA* para ver las opciones disponibles.`,

  yaRegistrado: `ℹ️ Ya tienes un registro activo.

🧾 Recibo: *{{recibo}}*

Escribe *ESTADO* para ver el estado de tu cuenta.
Escribe *REINICIAR* si quieres cambiar tus datos.`,

};

/**
 * Reemplaza las variables {{variable}} en un mensaje con valores reales.
 */
export function formatearMensaje(
  plantilla: string,
  vars: Record<string, string | undefined>
): string {
  return plantilla.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}
