# IPTV SaaS — Bot de WhatsApp Multi-Tenant

## Descripción General

Plataforma SaaS multi-tenant para automatización de servicios IPTV vía WhatsApp. Cada cliente (tenant) tiene su propio bot de WhatsApp, Google Sheet, credenciales CRM y Gmail. Un panel de superadmin centralizado gestiona todos los tenants desde una sola interfaz.

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js v24 |
| Lenguaje | TypeScript 5.9 |
| Monorepo | pnpm workspaces |
| API | Express 5 |
| Base de datos | PostgreSQL + Drizzle ORM 0.45 |
| WhatsApp | @whiskeysockets/baileys v7 RC |
| Google APIs | googleapis v150 (Sheets + Gmail OAuth2) |
| Validación | Zod v4 + drizzle-zod |
| Notificaciones | Pushover API |

---

## Arquitectura Multi-Tenant

```
Servidor Express (puerto 8080)
│
├── /api/panel          → Panel de Superadmin (HTML estático)
├── /api/admin/*        → API de Superadmin (protegida con ADMIN_TOKEN)
├── /api/bot/*          → Endpoints legacy del bot (Tasker, CRM, etc.)
├── /api/gmail/*        → Endpoints de Gmail OAuth
└── /api/healthz        → Health check
         │
         ▼
    BotManager (Map<tenantId, BotInstance>)
         │
         ├── BotInstance "tenant-a"
         │     ├── Baileys (WhatsApp connection)
         │     ├── auth_info_baileys/tenant-a/   ← sesión persistida
         │     ├── SheetsService (su spreadsheet)
         │     ├── CrmService (sus credenciales CRM)
         │     ├── GmailService (su OAuth Gmail)
         │     └── PushoverService (sus claves Pushover)
         │
         └── BotInstance "tenant-b"
               └── ...

         ▼
    PostgreSQL
    ├── tenants           ← config completa de cada cliente
    ├── tenant_pagos      ← copia central de pagos (auditoría)
    ├── tenant_cuentas    ← copia central de cuentas IPTV
    └── admin_sessions    ← sesiones panel admin (no usadas aún)
```

---

## Estructura de Archivos

```text
artifacts/api-server/
├── src/
│   ├── index.ts                       # Entry point (lee PORT, arranca Express)
│   ├── app.ts                         # Express setup, CORS, rutas, init bots
│   ├── bot/
│   │   ├── bot-instance.ts            # ★ BotInstance: un bot completo por tenant
│   │   ├── bot-manager.ts             # ★ Gestiona ciclo de vida de N instancias
│   │   ├── tenant-manager.ts          # ★ Carga/cachea tenants desde DB (TTL 60s)
│   │   ├── tenant-config.ts           # ★ Tipo TenantConfig + TenantPlan + mapeo DB→TS
│   │   ├── sheets-tenant.ts           # SheetsService tenant-aware
│   │   ├── crm-tenant.ts              # CrmService tenant-aware (Mastv)
│   │   ├── gmail-tenant.ts            # GmailService tenant-aware (polling)
│   │   ├── gmail-service.ts           # GmailService legacy (un tenant global)
│   │   ├── crm-service.ts             # CrmService legacy
│   │   ├── sheets.ts                  # SheetsService legacy
│   │   ├── whatsapp.ts                # Bot legacy (backward compat)
│   │   ├── responses.ts               # Mensajes por defecto (bienvenida, planes, etc.)
│   │   ├── planes.ts                  # Planes por defecto (si el tenant no tiene propios)
│   │   ├── media-handler.ts           # Envío fotos/videos por WhatsApp
│   │   ├── payment-store.ts           # Almacén en memoria de pagos pendientes
│   │   └── lid-map.ts                 # Mapa LID ↔ JID (persistido en disco)
│   ├── lib/
│   │   └── pushover.ts                # Cliente Pushover (notif. al admin del tenant)
│   ├── middlewares/
│   │   └── ...                        # Middleware Express
│   ├── routes/
│   │   ├── index.ts                   # Combina todos los routers
│   │   ├── admin.ts                   # ★ API superadmin + sirve index.html en /panel
│   │   ├── bot.ts                     # Endpoints Tasker / CRM / estado / sesión
│   │   ├── gmail.ts                   # Gmail OAuth (autorizar, callback, estado)
│   │   └── health.ts                  # GET /healthz
│   └── seed-tenants.ts                # Script seed de tenants de prueba
├── public/
│   └── admin/
│       └── index.html                 # ★ Panel de Superadmin (UI)
├── auth_info_baileys/
│   └── {tenantId}/                    # Sesiones WhatsApp persistidas por tenant
└── package.json

lib/db/
├── src/
│   ├── schema/index.ts                # Definición de tablas Drizzle
│   ├── index.ts                       # Exporta: db, pool, todas las tablas y schemas Zod
│   └── seed.ts                        # Seed data
└── drizzle.config.ts                  # Config Drizzle Kit (usa DATABASE_URL)
```

---

## Panel de Superadmin

### Acceso

- **URL**: `https://<dominio>/api/panel`
- **Token por defecto**: `superadmin_token_seguro_2024`
- **Cambiar token**: variable de entorno `ADMIN_TOKEN`
- El token se envía como header `x-admin-token` o query param `?token=...`

### Secciones de la UI

#### 🏢 Tenants
Vista principal con estadísticas globales y tabla de tenants:
- **Estadísticas en tiempo real**: total de tenants, bots activos, bots conectados, pagos registrados, cuentas registradas
- **Tabla de tenants**: muestra ID, nombre empresa, WhatsApp admin, badges de integración (Sheets / CRM / Gmail), estado del bot (punto verde/rojo/amarillo + texto del estado), estado de suscripción con fecha de vencimiento
- **Acciones por fila**: editar ✏️, reiniciar bot 🔄, enviar mensaje 💬, suspender/activar

#### 💰 Pagos
Vista consolidada de pagos de todos los tenants:
- Filtro por tenant (dropdown)
- Columnas: Tenant, Fecha, Nombre del cliente, Monto, Teléfono, Estado, Sincronizado
- Los pagos llegan vía Gmail polling o Sheets

#### 📋 Cuentas
Vista consolidada de cuentas IPTV de todos los tenants:
- Filtro por tenant (dropdown)
- Columnas: Tenant, Teléfono, Usuario CRM, Plan, Fecha creación, Fecha expiración, Estado

#### ➕ Nuevo Tenant
Formulario completo para crear un tenant:
- Campos de identidad: ID único (slug), nombre corto, nombre empresa, admin WhatsApp
- Credenciales CRM: URL base, username, password, prefijo de usuario
- Google: Spreadsheet ID, Service Account JSON, filtro de remitente Gmail
- Notificaciones: Pushover User Key, Pushover API Token
- Fecha de vencimiento de suscripción
- Checkbox para activar bot inmediatamente
- Campo de planes personalizados (JSON array)

#### Modal — Editar tenant
Permite actualizar todos los campos excepto el ID:
- Nombre, nombre empresa, admin WhatsApp
- Credenciales CRM (username, password, prefijo)
- Spreadsheet ID, suscripción vence
- Google Service Account JSON
- Al guardar: actualiza DB + reinicia bot automáticamente

#### Modal — Enviar mensaje
Envía un mensaje de WhatsApp desde el bot de cualquier tenant:
- Campo: teléfono destino (con código de país)
- Campo: texto del mensaje
- Requiere que el bot esté iniciado y conectado

---

## API de Superadmin

Todas las rutas requieren `x-admin-token` en el header (o `?token=...` en query).

### Bots y estado

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/admin/estado` | Estado de todos los bots activos |

**Respuesta `/api/admin/estado`**:
```json
{
  "ok": true,
  "bots": [
    { "tenantId": "zktv", "conectado": true, "estado": "listo" }
  ]
}
```

### Gestión de Tenants

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/admin/tenants` | Listar todos los tenants con estado del bot |
| `POST` | `/api/admin/tenants` | Crear nuevo tenant e iniciar su bot |
| `PUT` | `/api/admin/tenants/:id` | Actualizar config de un tenant + reiniciar bot |
| `POST` | `/api/admin/tenants/:id/suspender` | Desactivar tenant y detener su bot |
| `POST` | `/api/admin/tenants/:id/activar` | Activar tenant e iniciar su bot |

**Body `POST /api/admin/tenants`** (todos opcionales salvo los marcados):
```json
{
  "id": "mi-empresa",             // requerido, slug único
  "nombre": "Mi Empresa TV",      // requerido
  "nombreEmpresa": "Mi Empresa",  // requerido
  "adminWhatsapp": "59169000000", // requerido
  "crmBaseUrl": "https://resellermastv.com:8443",
  "crmUsername": "Zack",
  "crmPassword": "secreto",
  "crmUsernamePrefix": "zk",
  "spreadsheetId": "1IMij...",
  "googleServiceAccountJson": "{\"type\":\"service_account\",...}",
  "gmailRemitenteFiltro": "PagosBcp@bcp.com.bo",
  "gmailClientId": "...",
  "gmailClientSecret": "...",
  "gmailRefreshToken": "...",
  "pushoverUserKey": "u...",
  "pushoverApiToken": "a...",
  "planesJson": "[{\"codigo\":\"A\",\"nombre\":\"1 MES\",...}]",
  "suscripcionVence": "2025-12-31",
  "activo": true
}
```

### Control del Bot por Tenant

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/admin/tenants/:id/bot/reiniciar` | Detener y volver a iniciar el bot |
| `POST` | `/api/admin/tenants/:id/bot/activar` | Activar/desactivar respuestas del bot (`{ activo: bool }`) |
| `POST` | `/api/admin/tenants/:id/bot/codigo-pareo` | Obtener código de pareo para vincular WhatsApp (`{ telefono }`) |
| `POST` | `/api/admin/tenants/:id/bot/sesion/borrar` | Borrar sesión de WhatsApp del tenant |

**Flujo para conectar un nuevo bot vía código de pareo**:
1. El tenant debe estar creado y activo
2. Llamar `POST /api/admin/tenants/:id/bot/codigo-pareo` con `{ "telefono": "591XXXXXXXX" }`
3. En el WhatsApp del tenant: Dispositivos vinculados → Vincular con número → ingresar el código de 8 dígitos
4. El bot se conecta y queda listo

### Mensajería

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/admin/tenants/:id/mensaje` | Enviar mensaje desde el bot del tenant |

**Body**:
```json
{ "telefono": "59169000000", "mensaje": "Hola, tu cuenta está lista." }
```

### Pagos y Cuentas

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/admin/pagos` | Todos los pagos (hasta 500 por tenant) |
| `GET` | `/api/admin/pagos/:tenantId` | Pagos de un tenant específico |
| `GET` | `/api/admin/cuentas` | Todas las cuentas IPTV (hasta 1000) |
| `GET` | `/api/admin/cuentas/:tenantId` | Cuentas de un tenant específico |

---

## Schema de Base de Datos

### `tenants`

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | text PK | Slug único del tenant (ej: `zktv`) |
| `nombre` | text | Nombre corto |
| `nombre_empresa` | text | Nombre completo de la empresa |
| `admin_whatsapp` | text | Número con código de país (ej: `59169741630`) |
| `spreadsheet_id` | text | ID del Google Sheet del tenant |
| `google_service_account_json` | text | JSON completo de la service account |
| `crm_base_url` | text | URL del CRM (default: `https://resellermastv.com:8443`) |
| `crm_username` | text | Usuario CRM |
| `crm_password` | text | Contraseña CRM |
| `crm_username_prefix` | text | Prefijo para generar usernames de clientes (default: `zk`) |
| `gmail_client_id` | text | Client ID OAuth2 de Gmail |
| `gmail_client_secret` | text | Client Secret OAuth2 de Gmail |
| `gmail_refresh_token` | text | Refresh token OAuth2 de Gmail |
| `gmail_remitente_filtro` | text | Email del remitente que confirma pagos (ej: `PagosBcp@bcp.com.bo`) |
| `planes_json` | text | JSON array de planes personalizados (ver `TenantPlan`) |
| `pushover_user_key` | text | User Key de Pushover |
| `pushover_api_token` | text | API Token de Pushover |
| `activo` | boolean | Si el tenant está activo (bot corre) |
| `suscripcion_vence` | timestamp | Fecha de vencimiento de la suscripción con el superadmin |
| `creado_en` | timestamp | Fecha de creación |
| `actualizado_en` | timestamp | Última actualización |

### `tenant_pagos`

Copia central de todos los pagos detectados por cada bot (via Gmail o Sheets).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | serial PK | Auto-incremental |
| `tenant_id` | text FK | Referencia a `tenants.id` (cascade delete) |
| `fecha` | text | Fecha del pago (del correo o sheet) |
| `nombre` | text | Nombre del pagador |
| `monto` | real | Monto pagado |
| `telefono` | text | Teléfono del cliente (si disponible) |
| `fecha_registro` | text | Cuándo se registró en la hoja |
| `estado` | text | `"No usado"`, `"Usado"`, etc. |
| `gmail_id` | text | ID del correo de Gmail que originó el pago |
| `sincronizado_en` | timestamp | Cuándo se copió en esta tabla |

### `tenant_cuentas`

Copia central de cuentas IPTV creadas por todos los bots.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | serial PK | Auto-incremental |
| `tenant_id` | text FK | Referencia a `tenants.id` (cascade delete) |
| `telefono` | text | Teléfono del cliente |
| `usuario` | text | Username en el CRM |
| `plan` | text | Plan contratado |
| `fecha_creacion` | text | Fecha de creación de la cuenta |
| `fecha_expiracion` | text | Fecha de vencimiento |
| `estado` | text | `"ACTIVA"`, `"EXPIRADA"`, etc. |
| `sincronizado_en` | timestamp | Cuándo se sincronizó |

### `admin_sessions`

Sesiones del panel de superadmin (preparado para futuro uso con login por sesión).

| Campo | Tipo | Descripción |
|---|---|---|
| `token` | text PK | Token de sesión |
| `creado_en` | timestamp | Fecha de creación |
| `expira_en` | timestamp | Fecha de expiración |

---

## Tipo TenantPlan (planes personalizados)

Cada tenant puede sobrescribir los planes por defecto con un JSON array en `planesJson`:

```json
[
  {
    "codigo": "A",
    "nombre": "1 MES",
    "monto": 35,
    "descripcion": "Plan básico 1 mes",
    "tolerancia": 5,
    "dispositivos": 1,
    "duracion": "1 mes",
    "dias": 30,
    "crmPlanId": "1month"
  }
]
```

| Campo | Tipo | Descripción |
|---|---|---|
| `codigo` | string | Letra que el cliente escribe en WhatsApp para elegir el plan |
| `nombre` | string | Nombre visible del plan |
| `monto` | number | Precio en Bs |
| `descripcion` | string | Descripción breve |
| `tolerancia` | number | Tolerancia en Bs para validar el pago (ej: ±5 Bs) |
| `dispositivos` | number | Cantidad de dispositivos del plan |
| `duracion` | string | Descripción de la duración |
| `dias` | number | Días exactos del plan |
| `crmPlanId` | string | ID del plan en el CRM Mastv |

---

## Ciclo de Vida de un Bot

### Arranque del servidor
1. `iniciarTodosLosBots()` consulta los tenants activos en DB
2. Para cada tenant crea una `BotInstance` y la registra en el `Map` del `BotManager`
3. `botInstance.iniciar()` arranca la conexión Baileys de forma no-bloqueante
4. Si existe `auth_info_baileys/{tenantId}/`, restaura la sesión existente
5. Si no existe sesión, genera un QR en consola (o espera código de pareo)

### Estado de un bot
- `no_iniciado` — No existe instancia en el Map
- `iniciando` — Baileys iniciando conexión
- `qr` — Esperando escaneo de QR
- `pareo` — Esperando código de pareo
- `listo` / `conectado` — Conectado y respondiendo mensajes
- `desconectado` — Perdió la conexión (intenta reconectar)

### Reinicio tras edición de config
1. Admin edita tenant en el panel → `PUT /api/admin/tenants/:id`
2. El servidor actualiza DB y llama `reiniciarBot(id)`
3. `reiniciarBot` = `detenerBot` + `recargarTenant` desde DB + `iniciarBot`
4. El nuevo bot usa las credenciales actualizadas

---

## Integraciones por Tenant

### Google Sheets
- **Propósito**: Registro de pagos de clientes, planes vendidos, cuentas creadas
- **Configuración**: `spreadsheetId` + `googleServiceAccountJson`
- **Cómo configurar**: Crear una Service Account en Google Cloud → compartir el Sheet con el email de la service account → pegar el JSON completo en el campo del panel

### Gmail OAuth2
- **Propósito**: Detección automática de pagos vía correos de confirmación bancaria
- **Flujo de autorización** (una vez por tenant):
  1. Visitar `GET /api/gmail/autorizar` → devuelve una URL de Google
  2. El admin la abre en el navegador, inicia sesión con Gmail del tenant, acepta permisos
  3. Google redirige a `/api/gmail/callback` → muestra el `refresh_token`
  4. Guardar ese `refresh_token` en el campo `gmailRefreshToken` del tenant
- **Filtro de remitente**: solo procesa correos de `gmailRemitenteFiltro` (ej: `PagosBcp@bcp.com.bo`)

### CRM Mastv (IPTV)
- **Propósito**: Crear y renovar cuentas IPTV de clientes automáticamente
- **Configuración**: `crmBaseUrl`, `crmUsername`, `crmPassword`, `crmUsernamePrefix`
- **URL por defecto**: `https://resellermastv.com:8443`
- El prefix se usa para generar usernames únicos: `{prefix}{telefono}` (ej: `zk59169000000`)

### Pushover
- **Propósito**: Notificaciones push al celular del admin del tenant cuando ocurren eventos importantes (nuevo pago, error, etc.)
- **Configuración**: `pushoverUserKey` + `pushoverApiToken`
- Obtener en: https://pushover.net

---

## Endpoints Adicionales (no-admin)

### Bot (requieren `TASKER_TOKEN` o `x-bot-token`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/bot/estado` | Estado del bot legacy (primer tenant) |
| `POST` | `/api/bot/activar` | Activar/desactivar bot legacy `{ activo: bool }` |
| `POST` | `/api/bot/codigo-pareo` | Código de pareo bot legacy `{ telefono }` |
| `POST` | `/api/bot/sesion/borrar` | Borrar sesión WhatsApp legacy |
| `POST` | `/api/bot/sync-crm` | Sincronizar líneas CRM → Google Sheets |
| `GET` | `/api/ping` | Ping para UptimeRobot |

> ⚠️ Los endpoints `/api/bot/pago` y `/api/bot/pago-qr` (Tasker) están **desactivados**. El registro de pagos ahora lo hace Gmail automáticamente. El código se mantiene para reactivación futura.

### Gmail (sin autenticación)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/gmail/estado` | Ver si Gmail está activo y configurado |
| `GET` | `/api/gmail/autorizar` | Obtener URL de autorización OAuth2 |
| `GET` | `/api/gmail/callback` | Callback OAuth2 → devuelve refresh_token |
| `POST` | `/api/gmail/pausar` | Pausar/reanudar el polling de Gmail |

### Health

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/healthz` | `{ "status": "ok" }` |

---

## Flujo de Conversación del Bot (WhatsApp)

```
Cliente escribe cualquier cosa
  → Menú principal (opciones numeradas)
  
Cliente escribe número (1, 2, 3...)
  → Submenú de la opción elegida

Cliente escribe letra (A, B, C...)
  → Acción: mostrar plan, contratar, soporte

Cliente escribe "COMPROBAR"
  → Bot busca pago pendiente del cliente en Sheets/Gmail
  → Si encontrado: crea cuenta CRM y envía credenciales
  → Si no encontrado: pide reenviar comprobante

Cliente escribe "RENOVAR"
  → Flujo de renovación de cuenta existente
```

### Comandos de Admin (desde el número del bot)

| Comando | Acción |
|---|---|
| `/stop` | Silenciar bot en ese chat |
| `/start` | Reactivar bot en ese chat |
| `/status` | Ver estado del bot |
| `/silenciados` | Listar chats silenciados |
| `/limpiar` | Reactivar todos los chats silenciados |
| `/num` | Ver número real del JID del contacto |
| `/lidmap` | Ver tamaño del mapa LID en memoria |

---

## Variables de Entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | ✅ Sí | Connection string PostgreSQL |
| `PORT` | ✅ Sí | Puerto del servidor (el workflow lo pone en 8080) |
| `ADMIN_TOKEN` | No | Token del panel superadmin (default: `superadmin_token_seguro_2024`) |
| `TASKER_TOKEN` | No | Token para endpoints de bot/Tasker (default: `cambia_este_token_seguro_2024`) |
| `GMAIL_REMITENTE_FILTRO` | No | Filtro global de remitente Gmail (default: `PagosBcp@bcp.com.bo`) |

> ⚠️ **Seguridad**: Cambiar `ADMIN_TOKEN` y `TASKER_TOKEN` antes de usar en producción.

---

## Comandos Útiles

```bash
# Instalar dependencias
pnpm install

# Ver logs del servidor (QR, errores, mensajes)
# → Workflow "Start application" → pestaña Logs

# Sincronizar schema de DB
pnpm --filter @workspace/db run push

# Seed de tenants de prueba
pnpm --filter @workspace/api-server exec tsx src/seed-tenants.ts

# Panel de superadmin
# → Abrir: https://<dominio>/api/panel
# → Token default: superadmin_token_seguro_2024
```

---

## Tenants de Ejemplo

| ID | Empresa | Estado |
|---|---|---|
| `zktv` | ZKTV Bolivia | Activo — bot esperando QR/pareo |
| `demo-cliente` | Demo TV Bolivia | Suspendido — sin credenciales CRM |
