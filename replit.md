# IPTV SaaS — Bot de WhatsApp Multi-Tenant

## Descripción General

Plataforma SaaS multi-tenant para automatización de servicios IPTV vía WhatsApp. Cada cliente (tenant) tiene su propio bot de WhatsApp, Google Sheet, credenciales CRM y Gmail. Un panel de superadmin centralizado gestiona todos los tenants.

## Stack Tecnológico

- **Monorepo**: pnpm workspaces
- **Node.js**: v24
- **TypeScript**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **WhatsApp Bot**: @whiskeysockets/baileys v7 RC
- **Google Sheets**: googleapis v150
- **Validación**: Zod (v4), drizzle-zod

## Arquitectura Multi-Tenant

```
Un servidor → N bots de WhatsApp (uno por tenant activo)
                │
                ├── BotManager — Map<tenantId, BotInstance>
                │     └── BotInstance (por tenant)
                │           ├── WhatsApp (auth_info_baileys/{tenantId}/)
                │           ├── SheetsService (spreadsheetId propio)
                │           ├── CrmService (credenciales propias)
                │           └── GmailService (OAuth propio)
                │
                └── PostgreSQL
                      ├── tenants          — config de cada tenant
                      ├── tenant_pagos     — pagos centralizados (auditoría)
                      ├── tenant_cuentas   — cuentas IPTV centralizadas
                      └── admin_sessions   — sesiones del panel admin
```

## Estructura de Archivos

```text
artifacts/api-server/
├── src/
│   ├── app.ts                     # Express setup + init multi-tenant
│   ├── index.ts                   # Entry point
│   ├── bot/
│   │   ├── bot-instance.ts        # ★ BotInstance (un bot completo por tenant)
│   │   ├── bot-manager.ts         # ★ Gestiona N instancias de bot
│   │   ├── tenant-manager.ts      # ★ Carga/cachea tenants desde DB
│   │   ├── tenant-config.ts       # ★ Tipo TenantConfig + mapeo DB→TS
│   │   ├── sheets-tenant.ts       # ★ SheetsService (tenant-aware)
│   │   ├── crm-tenant.ts          # ★ CrmService (tenant-aware)
│   │   ├── gmail-tenant.ts        # ★ GmailService (tenant-aware)
│   │   ├── whatsapp.ts            # Bot original (backward compat)
│   │   ├── sheets.ts              # Sheets original (backward compat)
│   │   ├── responses.ts           # Mensajes por defecto
│   │   ├── planes.ts              # Planes por defecto
│   │   ├── media-handler.ts       # Envío fotos/videos
│   │   └── payment-store.ts       # Almacén local de pagos
│   └── routes/
│       ├── admin.ts               # ★ API de superadmin + panel HTML /api/panel
│       ├── bot.ts                 # Endpoints legacy del bot
│       ├── gmail.ts               # Endpoints de Gmail
│       └── health.ts              # /healthz
├── public/
│   └── admin/
│       └── index.html             # ★ Panel de superadmin (UI)
├── auth_info_baileys/             # Sesiones WhatsApp por tenant
│   ├── zktv/                      # Sesión del tenant ZKTV
│   └── {tenantId}/
└── package.json

lib/db/
├── src/
│   ├── schema/index.ts            # Tablas: tenants, tenant_pagos, tenant_cuentas
│   ├── index.ts                   # Exporta db, pool, schema
│   └── seed.ts                    # Script de seed (uno vez)
└── drizzle.config.ts
```

## Panel de Superadmin

**URL**: `/api/panel`

**Token por defecto**: `superadmin_token_seguro_2024` (cambiar con `ADMIN_TOKEN` env var)

### Funcionalidades:
- Ver todos los tenants con estado de bot en tiempo real
- Estadísticas globales (tenants, bots activos, conectados, pagos, cuentas)
- Crear nuevo tenant (con todas las credenciales)
- Editar tenant existente
- Suspender / Activar tenant (detiene/arranca el bot)
- Reiniciar bot por tenant
- Enviar mensaje desde el bot de cualquier tenant
- Ver pagos consolidados de todos los tenants
- Ver cuentas IPTV consolidadas de todos los tenants

## API de Admin (requiere header `x-admin-token` o query `?token=...`)

```
GET  /api/admin/estado              — Estado de todos los bots
GET  /api/admin/tenants             — Listar todos los tenants
POST /api/admin/tenants             — Crear tenant
PUT  /api/admin/tenants/:id         — Editar tenant
POST /api/admin/tenants/:id/suspender
POST /api/admin/tenants/:id/activar
POST /api/admin/tenants/:id/bot/reiniciar
POST /api/admin/tenants/:id/bot/codigo-pareo
POST /api/admin/tenants/:id/bot/activar
POST /api/admin/tenants/:id/bot/sesion/borrar
POST /api/admin/tenants/:id/mensaje
GET  /api/admin/pagos               — Pagos de todos los tenants
GET  /api/admin/pagos/:tenantId     — Pagos de un tenant
GET  /api/admin/cuentas             — Cuentas de todos los tenants
GET  /api/admin/cuentas/:tenantId   — Cuentas de un tenant
```

## Tenants de Prueba

| ID | Nombre | Estado |
|---|---|---|
| `zktv` | ZKTV Bolivia | Activo (bot esperando QR) |
| `demo-cliente` | Demo TV Bolivia | Suspendido (sin credenciales) |

## Variables de Entorno

### Requeridas
- `DATABASE_URL` — PostgreSQL connection string

### Opcionales (fallback a las del tenant en DB)
- `ADMIN_TOKEN` — Token del panel de superadmin (default: `superadmin_token_seguro_2024`)

### Por tenant (guardadas en DB, tabla `tenants`)
- `spreadsheetId` + `googleServiceAccountJson` — Google Sheets
- `crmUsername`, `crmPassword`, `crmBaseUrl`, `crmUsernamePrefix` — CRM IPTV
- `gmailClientId`, `gmailClientSecret`, `gmailRefreshToken`, `gmailRemitenteFiltro` — Gmail
- `pushoverUserKey`, `pushoverApiToken` — Notificaciones Pushover
- `planesJson` — Planes personalizados (JSON array)

## Schema de Base de Datos

```sql
tenants              — Config completa de cada cliente
tenant_pagos         — Copia central de pagos (para auditoría superadmin)
tenant_cuentas       — Copia central de cuentas IPTV (para auditoría superadmin)
admin_sessions       — Sesiones del panel admin
```

## Comandos Útiles

```bash
# Ver logs y QR del bot
# Workflow → "Start application" → Logs

# Seed de tenants (ejecutar una vez)
pnpm --filter @workspace/api-server exec tsx src/seed-tenants.ts

# Sincronizar schema DB
pnpm --filter @workspace/db push

# Panel de superadmin
# Abrir: https://<tu-dominio>/api/panel
```

## Flujo de Conversación del Bot

1. Cliente envía cualquier mensaje → **Saludo inicial** (menú de opciones)
2. Cliente escribe número (1-4) → Respuesta de submenú
3. Cliente escribe letra (A-L) → Acción específica (contratar plan, soporte)
4. Cliente escribe `COMPROBAR` → Verificación de pago
5. Cliente escribe `RENOVAR` → Flujo de renovación

## Comandos del Admin (vía WhatsApp desde el número del bot)
- `/stop` — Silenciar bot en ese chat
- `/start` — Reactivar bot en ese chat
- `/status` — Ver estado del bot
- `/silenciados` — Ver chats silenciados
- `/limpiar` — Reactivar todos los chats silenciados
- `/num` — Ver número real del JID
- `/lidmap` — Ver tamaño del mapa LID
