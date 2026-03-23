# 🔧 Comandos Shell para Reiniciar y Guardar Cambios

## ⚡ COMANDO RÁPIDO (RECOMENDADO)

Copia y pega esto en la **Terminal de Replit** (abajo en la ventana):

```bash
pnpm --filter @workspace/api-server run dev &
```

O si quieres más simple:

```bash
restart_workflow "artifacts/api-server: API Server"
```

---

## 📝 PASO A PASO: Editar y Guardar Cambios

### 1. Edita el archivo
- Abre: `src/bot/responses.ts`
- Busca lo que quieres cambiar
- Ejemplo: Cambiar `"TV INTERNET"` por `"ZKTV"`

Antes:
```typescript
export const SALUDO_INICIAL = `👋 *¡Hola! Bienvenido a TV Internet*
```

Después:
```typescript
export const SALUDO_INICIAL = `👋 *¡Hola! Bienvenido a ZKTV*
```

### 2. GUARDA EL ARCHIVO
**IMPORTANTE:** Presiona **Ctrl+S** (Windows) o **Cmd+S** (Mac)

Verás una marca en la pestaña del archivo desapareciendo = **GUARDADO** ✅

### 3. Abre la Terminal de Replit
Abajo de la pantalla, busca la pestaña **Terminal**

### 4. Ejecuta ESTE comando:

```bash
restart_workflow "artifacts/api-server: API Server"
```

Espera 5-10 segundos. Verás:
```
✅ Restarted workflow
```

### 5. Verifica que funcionó
- Escribe **HOLA** al bot
- Deberías ver `ZKTV` en lugar de `TV INTERNET`

---

## ❌ ¿Qué Pasó Con Tus Cambios?

**Causa:** No reiniciaste el servidor después de editar.

**Solución:**
1. Guarda el archivo (Ctrl+S)
2. Ejecuta el comando de reinicio
3. Listo

---

## 🚀 Ahora Con Sistema de Credenciales Automático

El bot ahora crea cuentas automáticamente desde el CRM:

```bash
Usuario CRM: Zack
Contraseña CRM: ZackDeveloper7889
Panel: https://resellermastv.com:8443/lines
```

**Flujo:**
1. Cliente elige plan (ejemplo: P1)
2. Bot se conecta al CRM
3. CRM crea una cuenta automática
4. Bot envía usuario y contraseña por WhatsApp

---

## 📋 Otros Comandos Útiles

### Ver logs del servidor en tiempo real:
```bash
tail -f /tmp/logs/artifactsapi-server_API_Server_*.log
```

### Ver si el servidor está corriendo:
```bash
curl http://localhost:8080/api/bot/estado
```

### Detener el servidor (si lo necesitas):
```bash
pkill -f "tsx ./src/index.ts"
```

### Limpiar sesión de WhatsApp (¡cuidado! Se desconecta):
```bash
rm -rf artifacts/api-server/auth_info_baileys/*
```

---

## ✅ Resumen Rápido

| Acción | Comando |
|--------|---------|
| **Editar y guardar** | Ctrl+S en el editor |
| **Reiniciar servidor** | `restart_workflow "artifacts/api-server: API Server"` |
| **Ver estado bot** | `curl http://localhost:8080/api/bot/estado` |
| **Ver logs** | Ver en Replit → Logs → API Server |

---

**¡Listo! Ahora sabes cómo hacer cambios permanentes.** 🎉
