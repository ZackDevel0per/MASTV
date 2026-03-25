# Workspace - Bot de WhatsApp para TV Internet

## Overview

pnpm workspace monorepo usando TypeScript. Bot de WhatsApp con Baileys integrado en el servidor API Express. Bot personalizado para venta de servicios de TV Internet con respuestas por comandos de número/letra y soporte para envío de fotos/videos.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **WhatsApp Bot**: @whiskeysockets/baileys v7 RC
- **Google Sheets**: googleapis v150

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server + WhatsApp Bot
│       └── src/
│           ├── bot/        # Módulos del bot
│           │   ├── whatsapp.ts       # Conexión Baileys + lógica principal
│           │   ├── responses.ts      # Mensajes personalizables (EDITAR AQUI)
│           │   ├── planes.ts         # Planes de servicio
│           │   ├── media-handler.ts  # Envío de fotos/videos
│           │   └── sheets.ts         # Integración Google Sheets (deprecado)
│           └── routes/
│               ├── health.ts
│               └── bot.ts   # Endpoints: /api/bot/pago, /api/bot/mensaje, /api/bot/imagen, etc.
│       ├── auth_info_baileys/  # Sesión de WhatsApp (auto-generada)
│       ├── GUIA_TASKER.md      # Guía de instalación y uso de Tasker
│       ├── ANALISIS_RECURSOS.md # Análisis de consumo (ancho de banda, energía)
│       └── package.json
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas
│   └── db/                 # Drizzle ORM schema
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Bot de WhatsApp (Rediseñado)

### Flujo de conversación (NUEVO)

1. Cliente escribe cualquier mensaje → Bot responde con **SALUDO INICIAL**
2. Cliente escribe un número (1, 2, 3, 4) → Bot responde con opciones del menú
3. Cliente escribe una letra (A, B, C, D, E, F) → Bot responde con opciones secundarias
4. Comandos especiales: HOLA, AYUDA, ESTADO, REINICIAR

### Respuestas disponibles:

**Menú principal (números):**
- **1** → Ver planes disponibles
- **2** → Características del servicio
- **3** → Centro de soporte
- **4** → Activar mi servicio

**Planes (letras):**
- **A** → Contratar Plan Básico (Bs 103/mes)
- **B** → Contratar Plan Premium (Bs 150/mes)
- **C** → Contratar Plan VIP (Bs 200/mes)

**Soporte (letras):**
- **D** → No puedo conectarme
- **E** → El video se corta
- **F** → Problema de login

### Cómo editar los mensajes

**ARCHIVO PRINCIPAL:** `src/bot/responses.ts`

Este archivo contiene TODOS los mensajes del bot. Puedes editar:
- Saludo inicial
- Respuestas por número
- Respuestas por letra
- Mensajes de error
- Cualquier texto sin tocar la lógica

**Ejemplo:**
```typescript
export const SALUDO_INICIAL = `👋 *¡Hola! Bienvenido a ZKTV*
// Edita aquí el texto...
`
```

### Cómo editar los planes

**ARCHIVO:** `src/bot/planes.ts`

Define los planes de servicio:
```typescript
export const PLANES: Plan[] = [
  {
    codigo: "103",
    nombre: "Servicio Mensual",
    monto: 103,
    descripcion: "✅ *Plan Mensual - Bs 103*",
    tolerancia: 1,
  },
  // Agregar más planes aquí
];
```

### Envío de fotos y videos

**Para enviar imagen:**
```bash
curl -X POST https://tu-dominio/api/bot/imagen \
  -H "Content-Type: application/json" \
  -d '{
    "token": "tu_token",
    "telefono": "59169741630",
    "url": "https://ejemplo.com/imagen.jpg",
    "pie": "Descripción de la foto"
  }'
```

**Para enviar video:**
```bash
curl -X POST https://tu-dominio/api/bot/video \
  -H "Content-Type: application/json" \
  -d '{
    "token": "tu_token",
    "telefono": "59169741630",
    "url": "https://ejemplo.com/video.mp4",
    "pie": "Descripción del video"
  }'
```

**Nota:** Las URLs deben ser **HTTPS** (publicas). Guarda los medios en un servidor o Google Drive compartido.

### Endpoints API

**Activar/Desactivar bot:**
```bash
POST /api/bot/activar
{ "activo": true }
```

**Ver estado:**
```bash
GET /api/bot/estado
```

**Procesar pago (desde Tasker):**
```bash
POST /api/bot/pago
{
  "token": "tu_token",
  "nombreCliente": "Nombre",
  "telefono": "59169741630",
  "usuario": "usuario",
  "contrasena": "password123",
  "plan": "Plan Básico"
}
```

**Enviar mensaje personalizado:**
```bash
POST /api/bot/mensaje
{
  "token": "tu_token",
  "telefono": "59169741630",
  "mensaje": "Hola, tu mensaje aqui"
}
```

**Código de pareo (conectar bot a WhatsApp):**
```bash
POST /api/bot/codigo-pareo
{ "telefono": "59169741630" }
```

**Ping (para UptimeRobot):**
```bash
GET /api/ping
```

### Tasker Integration

**Guía completa:** Ver `GUIA_TASKER.md` en `artifacts/api-server/`

**Resumen rápido:**
1. Instala Tasker en Android
2. Crea un Perfil → Notificación (detecta pagos)
3. Crea una Task → HTTP Post
4. Configura: URL, Token, Datos JSON
5. ¡Listo! Los pagos se automatizan

### Consumo de recursos

**Análisis detallado:** Ver `ANALISIS_RECURSOS.md` en `artifacts/api-server/`

**Resumen:**
- **Texto:** ✅ Completamente gratuito y seguro
- **Imágenes:** ✅ Seguro si las comprimes (< 400 KB)
- **Videos:** ⚠️ Usar ocasionalmente, cortos (< 3 min, 240p)
- **Consumo/mes:** ~500-1000 clientes = 1-2 GB (gratuito en Replit)
- **Conclusión:** El bot NO consume muchos recursos 🚀

### Variables de entorno requeridas

- `GMAIL_CLIENT_ID` — ID de cliente OAuth2 de Google Cloud (para Gmail)
- `GMAIL_CLIENT_SECRET` — Secreto de cliente OAuth2 de Google Cloud
- `GMAIL_REFRESH_TOKEN` — Token de refresco Gmail (se obtiene via /api/gmail/autorizar)
- `GMAIL_REMITENTE_FILTRO` — Email del banco/remitente a vigilar (ej: banco@bancounion.com.bo). Si no se configura, lee TODOS los no leídos.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON de cuenta de servicio de Google Sheets (opcional/deprecado)
- `TASKER_TOKEN` — Token de Tasker (desactivado, guardado para uso futuro)

### Para mantener activo con UptimeRobot

Configurar monitor HTTP GET a: `https://<tu-dominio>/api/ping` cada 5 minutos

---

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck`.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array.

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server + Bot de WhatsApp.

- Entry: `src/index.ts`
- App setup: `src/app.ts` — monta CORS, JSON, routes, inicia bot
- Bot: `src/bot/whatsapp.ts` — Baileys connection + conversación
- Respuestas: `src/bot/responses.ts` — Mensajes editables
- Planes: `src/bot/planes.ts` — Configuración de planes
- Media: `src/bot/media-handler.ts` — Envío de fotos/videos
- Sheets: `src/bot/sheets.ts` — Google Sheets API (deprecado)
- Routes: `src/routes/bot.ts` — Todos los endpoints
- `pnpm --filter @workspace/api-server run dev` — run the dev server

---

## Menú de Planes Actualizado

El bot ahora ofrece un flujo interactivo de planes:

**Opción 1 → Ver Planes**
- Pregunta: "¿Para cuántos dispositivos requiere el servicio?"
- Opciones: 1, 2, 3 dispositivos
- Submenuú con 4 duraciones cada uno (1, 3, 6, 12 meses)
- Precios actualizados con bonificaciones por duración

**Nuevos Comandos de Planes:**
- **1.1** → Planes 1 dispositivo (Bs 29, 82, 155, 300)
- **1.2** → Planes 2 dispositivos (Bs 35, 100, 190, 380)
- **1.3** → Planes 3 dispositivos (Bs 40, 115, 225, 440)
- **A-D** → Contratar plan 1 dispositivo
- **E-H** → Contratar plan 2 dispositivos
- **I-L** → Contratar plan 3 dispositivos

## Detección Mejorada de Saludos

El bot ahora reconoce automáticamente estos saludos y responde con el menú inicial:
- "Hola", "Hi", "Buenos días", "Buenas noches", "Buenas tardes"
- "Buen día", "Buena noche", "Buena tarde"
- "¿Cuáles son los planes?", "Quiero información"
- "Más información", "Planes", "Contratar", "Suscripción"
- "¿Cuánto cuesta?", "Precios", "Precio"
- Cualquier mensaje que contenga estas palabras clave

**Beneficio:** Ya no necesitas escribir exactamente "HOLA". El bot es inteligente y detecta intención.

## Próximos pasos

1. ✅ Bot conectado a WhatsApp
2. ✅ Respuestas personalizables
3. ✅ Planes actualizados con tu estructura
4. ✅ Detección mejorada de saludos
5. 📖 Lee `GUIA_TASKER.md` para configurar automatización
6. 📊 Lee `ANALISIS_RECURSOS.md` para entender consumo
7. 📱 Descarga Tasker en Android y automatiza pagos
8. 🧪 Prueba escribiendo: "Buenos días", "¿Qué planes tienen?", "Hola"

---

## Comandos útiles

### Activar bot:
```bash
curl -X POST http://localhost:8080/api/bot/activar -H "Content-Type: application/json" -d '{"activo": true}'
```

### Ver logs del servidor (y ver el QR):
Replit → Logs → API Server

### ⚡ REINICIAR el servidor después de editar código:
Desde la consola/shell de Replit:
```bash
# Opción 1 (recomendada): desde la Shell de Replit
kill $(lsof -t -i:8080) 2>/dev/null; PORT=8080 pnpm --filter @workspace/api-server run dev &
```
O simplemente haz clic en el botón **Restart** del workflow en Replit.

### Dónde editar mensajes:
- **Todos los mensajes del bot**: `artifacts/api-server/src/bot/responses.ts`
- **Después de editar** → SIEMPRE reiniciar el servidor (ver arriba)

### Cambiar token:
Replit → Secrets → TASKER_TOKEN → (editar) → Guardar

### Conectar bot a WhatsApp:
```bash
curl -X POST http://localhost:8080/api/bot/codigo-pareo -H "Content-Type: application/json" -d '{"telefono": "59169741630"}'
```

---

**¡Tu bot está listo para usar! 🎉**
