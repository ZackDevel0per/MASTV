# 📱 Guía de Instalación y Configuración de Tasker para Pago Automático

## Qué es Tasker y por qué lo necesitas

Tasker es una aplicación de automatización para Android que detecta notificaciones de pago y se las envía automáticamente a tu bot de WhatsApp.

**Flujo:**
```
1. Recibes notificación de pago en tu banco/billetera
2. Tasker detecta la notificación
3. Tasker extrae los datos (monto, referencia, etc.)
4. Tasker llama a tu bot con: POST /api/bot/pago
5. Bot valida y envía credenciales al cliente
```

---

## Paso 1: Descargar e Instalar Tasker

### Opción A: Desde Google Play (de pago, ~34 Bs)
1. Abre **Google Play Store** en tu Android
2. Busca **Tasker**
3. Descargalo del desarrollador **João Dias**
4. Abre la app y otorga permisos de administrador

### Opción B: Desde APK (gratis, alternativa)
1. Ve a **apkcombo.com** o **apkmirror.com**
2. Busca **Tasker**
3. Descargalo (elige versión 6.2 o superior)
4. Abre el APK e instala

---

## Paso 2: Otorgar Permisos a Tasker

Tasker necesita permisos especiales para leer notificaciones:

### En Android 12+:
1. **Ajustes → Aplicaciones → Tasker**
2. **Permisos → Notificaciones** → Habilitar
3. **Permisos → Acceso de dispositivo** → Habilitar

### En Android 11 o anterior:
1. **Ajustes → Seguridad → Aplicaciones de administrador**
2. Marca **Tasker**

---

## Paso 3: Crear la Tarea en Tasker

Ahora vamos a crear la automatización que detecta pagos.

### Crear un Perfil de Notificación

1. **Abre Tasker**
2. Ve a la pestaña **PERFILES** (abajo)
3. Toca el botón **+** (crear nuevo perfil)
4. Selecciona **Notificación**

### Configurar el Filtro de Notificación

5. **Selector de aplicación:**
   - Toca el nombre de la app que te envía notificaciones de pago
   - Ejemplo: Tu banco, billetera virtual, etc.

6. **Filtro de título o contenido:**
   - Si quieres solo notificaciones con "pago" o "monto":
   - Marca **Contains** y escribe: `pago` o `depósito`

7. **Toca el ✓ (aceptar)**

### Crear la Acción (Task)

8. **Aparecerá un cuadro pidiendo crear una Task**
   - Ponle nombre: `Procesar Pago`
   - Toca el ✓

9. **Ahora estás en el editor de tareas**
   - Toca el **+** para agregar una acción
   - Selecciona: **Net → HTTP Post**

---

## Paso 4: Configurar la Petición HTTP POST

Aquí es donde le decimos a Tasker qué enviar a tu bot:

### En "HTTP Post":

**1. Server:Port**
```
https://9c9ef8de-1d2b-415c-aeeb-a28b6e6e7e62-00-2pb5b83ilx5nw.riker.replit.dev/api/bot/pago
```
⚠️ **Cambia este dominio por el tuyo** (mira en Replit > preview)

**2. Data / File / Headers**

Toca **Data** e ingresa (como raw JSON):
```json
{
  "token": "tu_token_secreto",
  "nombreCliente": "Cliente desde Tasker",
  "telefono": "59169741630",
  "usuario": "usuario",
  "contrasena": "password123",
  "plan": "Plan Básico"
}
```

**3. Headers**
Toca el botón **Header** e ingresa:
```
Content-Type: application/json
```

**4. Toca ✓ (guardar)**

---

## Paso 5: Extraer Datos Automáticamente (Opcional pero Recomendado)

Si quieres que Tasker **extraiga el monto automáticamente** de la notificación:

### Agregar Variables Locales

1. **Antes de HTTP Post, agrega una acción:**
   - Toca **+**
   - **Variables → Variable Search Replace**

2. **Configura para buscar el monto en el texto de la notificación:**
   - **Input**: `%TINTENT` (contenido de la notificación)
   - **Search**: `Bs (\d+)` (busca "Bs" seguido de números)
   - **Replace**: `$1` (guarda solo el número)
   - **Output**: `%MONTO`

3. **Luego en HTTP Post, usa esta variable:**
```json
{
  "token": "tu_token_secreto",
  "nombreCliente": "Cliente",
  "telefono": "59169741630",
  "usuario": "usuario",
  "contrasena": "password123",
  "plan": "Plan Básico",
  "monto": "%MONTO"
}
```

---

## Paso 6: Probar la Configuración

### Prueba manual:

1. **En Tasker**, ve a **TASKS**
2. Toca **Procesar Pago** (tu tarea)
3. Toca el botón **Play ▶️**
4. Deberías ver en los logs si la petición fue exitosa

### Prueba real:

1. Realiza una transferencia/pago desde tu banco
2. Deberías recibir una notificación
3. Tasker debería detectarla y enviar los datos

---

## Paso 7: Troubleshooting (Solucionar Problemas)

### ❌ Tasker no detecta la notificación
- Verifica que hayas habilitado **Notificaciones** en permisos
- Asegúrate de haber seleccionado la app correcta
- Prueba con el filtro vacío (sin "Contains")

### ❌ La petición HTTP falla
- Verifica que el **dominio sea correcto**
- Revisa que el **JSON esté bien formado** (sin errores de sintaxis)
- Comprueba que el **token sea igual** al del servidor

### ❌ El bot no recibe nada
- Ve a **Estado del Bot** en Replit
- Revisa los logs del servidor
- Verifica que el bot esté **ACTIVADO** (POST /api/bot/activar)

---

## Token de Seguridad

### ¿Dónde viene el token?

Tu token está en:
```
Replit → Secrets → TASKER_TOKEN
```

**Valor por defecto:** `cambia_este_token_seguro_2024`

### ¿Cómo cambiarlo?

1. **Replit → Tu proyecto**
2. **Tools → Secrets**
3. Edita `TASKER_TOKEN`
4. Pon algo como: `mi_token_super_secreto_2024`
5. **Guarda**
6. Actualiza el mismo valor en tu Task de Tasker

---

## Endpoints Disponibles

Además de `/api/bot/pago`, tienes otros endpoints útiles:

### Ver estado del bot:
```
GET /api/bot/estado
```

### Activar/Desactivar bot:
```
POST /api/bot/activar
{
  "activo": true  // o false
}
```

### Enviar mensaje personalizado:
```
POST /api/bot/mensaje
{
  "token": "tu_token",
  "telefono": "59169741630",
  "mensaje": "Hola, esto es un test"
}
```

### Enviar imagen:
```
POST /api/bot/imagen
{
  "token": "tu_token",
  "telefono": "59169741630",
  "url": "https://ejemplo.com/imagen.jpg",
  "pie": "Descripción opcional"
}
```

### Enviar video:
```
POST /api/bot/video
{
  "token": "tu_token",
  "telefono": "59169741630",
  "url": "https://ejemplo.com/video.mp4",
  "pie": "Descripción opcional"
}
```

---

## Ejemplo Completo: Tasker + Expresiones Regulares

Si tu notificación dice: **"Pago recibido. Monto: Bs 103. Ref: ABC123"**

### Para extraer monto y referencia:

**1. Agregar variable "Extraer Monto":**
```
Acción: Variable Search Replace
Input: %TINTENT
Search: Monto: Bs (\d+)
Output: %MONTO
```

**2. Agregar variable "Extraer Referencia":**
```
Acción: Variable Search Replace
Input: %TINTENT
Search: Ref: (\w+)
Output: %REF
```

**3. Usar en HTTP Post:**
```json
{
  "token": "tu_token",
  "nombreCliente": "Cliente Ref %REF",
  "telefono": "59169741630",
  "usuario": "usuario_%REF",
  "contrasena": "pass_%MONTO",
  "plan": "Plan Básico",
  "monto": "%MONTO"
}
```

---

## Recomendaciones de Seguridad

⚠️ **Importante:**

1. **Guarda tu token en un lugar seguro**
   - No lo compartas por WhatsApp
   - No lo expongas en logs públicos

2. **Usa HTTPS siempre**
   - El dominio de Replit ya es HTTPS

3. **Cambia el token regularmente**
   - Especialmente si crees que fue comprometido

4. **Monitorea los logs**
   - Revisa qué peticiones llegan a tu bot

---

## Próximos Pasos

1. ✅ Instala Tasker
2. ✅ Crea la tarea "Procesar Pago"
3. ✅ Prueba con una notificación real
4. ✅ Ajusta según sea necesario
5. ✅ Disfruta del bot automático 🎉

---

¿Preguntas? Revisa los logs en Replit o escribe directamente al bot.
