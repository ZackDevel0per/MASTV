# 📝 Guía: Cómo Editar los Planes del Bot

## 🎯 Ubicación de los Archivos

### 1. **MENSAJES Y TEXTOS DE PLANES**
**Archivo:** `src/bot/responses.ts`

Este archivo contiene **TODOS LOS TEXTOS** que ves en el bot.

**¿Qué editar?**
- Textos de planes (precios, duraciones, beneficios)
- Mensajes de bienvenida
- Respuestas personalizadas
- Palabras clave de saludo

**Ejemplo - Editar precio de plan 1 dispositivo/1 mes:**

Busca esta sección:
```
"P1": [
  {
    tipo: "text",
    contenido: `✅ *Plan Seleccionado: 1 Dispositivo - 1 Mes*
💰 Bs 29  ← CAMBIA AQUÍ
```

### 2. **INFORMACIÓN TÉCNICA DE PLANES**
**Archivo:** `src/bot/planes.ts`

Este archivo tiene la estructura de datos de los planes.

**¿Qué editar?**
- Montos exactos
- Tolerancia de pago
- Cantidad de dispositivos
- Duración en meses

---

## 📊 Sistema de Comandos (SIN BUCLES)

Para evitar el problema que tenías, usamos letras distintas:

### Primer Paso: Seleccionar Dispositivos
```
Usuario escribe: 1
Bot pregunta: ¿Para cuántos dispositivos?
```

### Segundo Paso: Seleccionar Dispositivos (Letras Únicas)
```
P → 1 dispositivo
Q → 2 dispositivos
R → 3 dispositivos
```

### Tercer Paso: Seleccionar Plan (Letras + Números)

**Para 1 dispositivo (P):**
- P1 → 1 mes (Bs 29)
- P2 → 3 meses (Bs 82)
- P3 → 6 meses (Bs 155)
- P4 → 12 meses (Bs 300)

**Para 2 dispositivos (Q):**
- Q1 → 1 mes (Bs 35)
- Q2 → 3 meses (Bs 100)
- Q3 → 6 meses (Bs 190)
- Q4 → 12 meses (Bs 380)

**Para 3 dispositivos (R):**
- R1 → 1 mes (Bs 40)
- R2 → 3 meses (Bs 115)
- R3 → 6 meses (Bs 225)
- R4 → 12 meses (Bs 440)

**Ventaja:** Cada comando es ÚNICO, NO hay conflictos de bucles.

---

## 🔧 Cómo Editar un Plan

### Ejemplo: Cambiar precio de Q2 (2 dispositivos, 3 meses)

1. Abre `src/bot/responses.ts`
2. Busca: `"Q2":`
3. Encuentra la línea: `💰 Bs 100`
4. Cámbialo a: `💰 Bs 105` (o el precio que quieras)

**Antes:**
```typescript
"Q2": [
  {
    tipo: "text",
    contenido: `✅ *Plan Seleccionado: 2 Dispositivos - 3 Meses*
💰 Bs 100
```

**Después:**
```typescript
"Q2": [
  {
    tipo: "text",
    contenido: `✅ *Plan Seleccionado: 2 Dispositivos - 3 Meses*
💰 Bs 105
```

---

## 🚀 Cómo Guardar Cambios y Reiniciar

### Opción 1: Reiniciar desde Replit (SIN DESCONECTAR WHATSAPP)

1. Haz tu cambio en el archivo
2. **Guarda** (Ctrl+S o Cmd+S)
3. Ve a **Replit → Workflows (o Deployments)**
4. Busca: **"artifacts/api-server: API Server"**
5. Haz clic en el botón **⟳ Restart** (Reiniciar)
6. Espera 5-10 segundos a que se reinicie
7. **¡Listo!** El WhatsApp sigue conectado, solo se recargó el código

### Opción 2: Desde la Terminal (Avanzado)

Si prefieres, puedes reiniciar solo el servidor API:

```bash
# En la terminal de Replit:
# Los cambios se aplican automáticamente al guardar
# Si quieres forzar un reinicio:
restart_workflow "artifacts/api-server: API Server"
```

---

## ✅ Verificar que los Cambios Se Aplicaron

1. Después de reiniciar, escribe **HOLA** al bot
2. Luego escribe **1** (Ver planes)
3. Luego escribe **P** (1 dispositivo)
4. Verifica que el precio actualizado aparece

Si no ves los cambios:
- Aguarda 10 segundos después de reiniciar
- Intenta escribir de nuevo
- Si aún no funciona, revisa que no haya errores de sintaxis

---

## 📋 Lista Completa de Comandos Editable

En `responses.ts`, encontrarás estas secciones editables:

| Comando | Archivo | Sección |
|---------|---------|---------|
| Saludo inicial | `responses.ts` | `SALUDO_INICIAL` |
| 1 dispositivo | `responses.ts` | `"P":` (menú) y `"P1","P2","P3","P4":` (planes) |
| 2 dispositivos | `responses.ts` | `"Q":` (menú) y `"Q1","Q2","Q3","Q4":` (planes) |
| 3 dispositivos | `responses.ts` | `"R":` (menú) y `"R1","R2","R3","R4":` (planes) |
| Características | `responses.ts` | `"2":` |
| Soporte | `responses.ts` | `"3":` |
| Activar | `responses.ts` | `"4":` |

---

## 🔒 Seguridad

**El WhatsApp seguirá conectado:**
- Los datos de autenticación se guardan en `auth_info_baileys/`
- Reiniciar el servidor solo recarga el código
- Mientras no elimines esa carpeta, el bot permanece vinculado

---

## 💡 Consejos

1. **Siempre guarda antes de reiniciar**
2. **Copia el texto original antes de editar** (por si cometes un error)
3. **Verifica la sintaxis** (que los comillas y paréntesis coincidan)
4. **Reinicia solo cuando hayas terminado todos los cambios**

---

¿Más preguntas? El sistema está completamente resuelto. Ya no hay bucles porque cada comando es único 🎉
