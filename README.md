# CRM NEXUS

**WhatsApp, llamadas, SMS, correo y automatizaciones desde una sola plataforma — sin depender de un único proveedor.**

CRM NEXUS es un SaaS multi-empresa (multi-tenant) que centraliza la comunicación entre un negocio y sus clientes. Cada canal se entrega a través del proveedor que el negocio elija (Twilio para voz y SMS, Meta para WhatsApp, SendGrid para correo…) y todo vive en la misma bandeja, el mismo historial de contacto y el mismo motor de automatizaciones.

---

## Módulos

| Módulo | Qué hace |
| --- | --- |
| **Conversaciones** | Bandeja unificada WhatsApp/SMS/correo en tiempo real (Socket.IO), filtros, asignación a agentes, estados de entrega (✓ ✓✓), plantillas, vista de todos los canales de un mismo contacto. |
| **Contactos** | Alta, edición, importación CSV con mapeo de columnas y deduplicación, campos personalizados, **etiquetas**, **segmentos dinámicos** por reglas y **verificación de canales** (Twilio Lookup, `onWhatsApp` de WhatsApp Web, registros MX para correo). Opt-out automático con STOP/BAJA. |
| **Campañas** | Envíos masivos por canal a segmentos/etiquetas, con plantillas o mensaje libre, programación, límite de mensajes por minuto, pausa/reanudación y estadísticas por destinatario. |
| **Telefonía** | Softphone en el navegador con **Twilio Voice JS SDK**: llamadas salientes y entrantes (suenan en todos los agentes conectados), teclado DTMF, silencio, grabación opcional, buzón de voz, historial y notas. |
| **WhatsApp** | Vinculación de números por **código QR (WhatsApp Web)** además de Meta Cloud API y WhatsApp vía Twilio. Varias líneas a la vez. |
| **Automatizaciones** | Editor visual de workflows (React Flow) con disparadores, **condiciones**, esperas, **webhooks**, **agente de IA (Claude)**, conectores con servicios externos (Slack, Discord, Teams, Google Sheets, Zapier, Make, n8n) y acciones sobre contactos/conversaciones. |
| **Plantillas** | Mensajes reutilizables para WhatsApp, SMS y correo con variables (`{{contact.firstName}}`), vista previa en vivo, contador de segmentos SMS e ID de plantilla aprobada en Meta. |
| **Ajustes** | Catálogo de proveedores, conexiones con credenciales cifradas, **enrutamiento por canal con failover**, equipo y roles, y un sandbox para simular mensajes entrantes. |

## Independencia de proveedor

El núcleo de la plataforma habla de **canales** (`WHATSAPP`, `SMS`, `EMAIL`, `VOICE`), nunca de proveedores. Cada proveedor es un adaptador que implementa la misma interfaz:

```ts
interface ProviderAdapter {
  send(message: OutboundMessage): Promise<SendResult>;
  test(): Promise<{ ok: boolean; detail?: string }>;
  verifyAddress?(channel, address): Promise<VerifyResult>;
  voice?: { createAccessToken(identity): string; callerId(): string | undefined };
}
```

| Proveedor | WhatsApp | SMS | Correo | Voz |
| --- | :-: | :-: | :-: | :-: |
| Twilio | ✅ | ✅ | | ✅ (navegador) |
| Meta WhatsApp Cloud API | ✅ (plantillas aprobadas) | | | |
| WhatsApp Web (QR, Baileys) | ✅ | | | |
| SMTP (Gmail, SES, Postmark…) | | | ✅ | |
| SendGrid / Resend / Mailgun | | | ✅ | |
| Sandbox (simulado) | ✅ | ✅ | ✅ | ✅ |

En **Ajustes → Enrutamiento** se decide qué conexión entrega cada canal y en qué orden: si el proveedor principal falla con un error reintentable, el mensaje sale automáticamente por el siguiente (failover) y queda registrado en el mensaje. Una conversación responde siempre por la misma línea por la que llegó.

**Añadir un proveedor nuevo** (Vonage, Plivo, Telnyx, 360dialog, Amazon SES…) consiste en crear un archivo en `apps/api/src/providers/` que exporte un `ProviderDefinition` (campos de credenciales que la UI pinta sola, canales, URLs de webhook y `create()`), y registrarlo en `providers/registry.ts`.

## Arquitectura

```
apps/
  api/                Node 22 + Express + Prisma (PostgreSQL) + Socket.IO
    prisma/           esquema, migraciones y seed de demo
    src/providers/    adaptadores (twilio, meta-whatsapp, whatsapp-web, email, mock) + registro
    src/services/     mensajería y failover, verificación, segmentos, campañas, scheduler, bus de eventos
    src/automation/   motor de workflows, nodos, disparadores y agente de IA
    src/routes/       API REST + webhooks públicos de proveedores
    test/             tests de integración (Vitest + Supertest)
  web/                React 18 + Vite + Tailwind + TanStack Query + React Flow + Twilio Voice SDK
```

- **Multi-tenant**: toda entidad pertenece a un `Workspace`; el JWT lleva el workspace activo y cada consulta filtra por él. Roles `OWNER`, `ADMIN`, `AGENT`.
- **Credenciales cifradas** con AES-256-GCM (`ENCRYPTION_KEY`); la API nunca las devuelve completas.
- **Webhooks validados**: firma `X-Twilio-Signature` (obligatoria en producción) y `X-Hub-Signature-256` de Meta. Los reintentos de webhooks no duplican mensajes.
- **Scheduler** en proceso (cada 5 s): lanza campañas programadas, envía lotes respetando el límite por minuto y reanuda workflows en espera. El estado vive en PostgreSQL, así que sobrevive a reinicios.
- **Tiempo real**: los eventos (`message:new`, `message:status`, `whatsapp:status`, `call:incoming`, `campaign:progress`…) se emiten por Socket.IO a la sala del workspace.

## Puesta en marcha (desarrollo)

Requisitos: Node 20+ y PostgreSQL 14+.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # ajusta DATABASE_URL, JWT_SECRET y ENCRYPTION_KEY
#   ENCRYPTION_KEY: openssl rand -hex 32
npm run db:migrate                          # crea las tablas
npm run db:seed                             # workspace de demo
npm run dev                                 # API en :4000 y web en :5173
```

Entra en <http://localhost:5173> con **demo@nexus.dev / nexus1234**. El workspace de demo usa el proveedor **Sandbox**, así que todo funciona sin credenciales: envía mensajes, lanza la campaña de ejemplo, simula mensajes entrantes desde **Ajustes → Sandbox** y verás dispararse la automatización “Respuesta a consultas de precio”.

Con Docker: `cp apps/api/.env.example apps/api/.env && docker compose up --build` → web en <http://localhost:8080>.

### Exponer los webhooks

Twilio y Meta necesitan llegar a tu API. En local usa un túnel (`ngrok http 4000` o `cloudflared tunnel --url http://localhost:4000`) y pon esa URL en `PUBLIC_URL`. Cada conexión muestra en **Ajustes → Proveedores** las URLs exactas que debes pegar en el panel del proveedor.

## Configurar proveedores

### Twilio (SMS, WhatsApp y voz)
1. Crea la conexión con *Account SID* y *Auth Token*, y los números remitentes.
2. En tu número de Twilio: **A message comes in** → `…/webhooks/twilio/<id>/inbound`; **A call comes in** → `…/webhooks/twilio/<id>/voice`.
3. Para llamadas desde el navegador crea una **API Key** y una **TwiML App** cuyo *Voice URL* sea `…/webhooks/twilio/<id>/voice`; añade *API Key SID/Secret* y *TwiML App SID* a la conexión.
4. Asigna la conexión al canal **Voz** (y SMS/WhatsApp si quieres) en *Enrutamiento*.

### Meta WhatsApp Cloud API
1. Crea la conexión con el *Access Token* de un System User, el *Phone Number ID*, el *App Secret* y un *Verify Token* inventado.
2. En la app de Meta → WhatsApp → Configuración, usa como Callback URL `…/webhooks/meta/<id>` con ese Verify Token y suscríbete a `messages`.
3. Para escribir fuera de la ventana de 24 h usa plantillas aprobadas: en la plantilla de NEXUS rellena **ID externo** con su nombre en Meta. Las variables se envían en el orden en que aparecen en el cuerpo.

### WhatsApp Web (QR)
En **WhatsApp → Vincular número** se genera un QR; escanéalo desde *WhatsApp → Dispositivos vinculados*. La sesión se guarda en `WA_SESSIONS_DIR` y se restaura al reiniciar. Usa [Baileys](https://github.com/WhiskeySockets/Baileys) (dependencia opcional, sin Chromium). No es una API oficial: para campañas y alto volumen usa la Cloud API.

### Correo
SMTP, SendGrid, Resend o Mailgun con el remitente que quieras. Para recibir respuestas, apunta el *inbound parse / route* de tu proveedor a `…/webhooks/email/<id>/inbound` (acepta JSON o formulario).

### Agente de IA
Define `ANTHROPIC_API_KEY` (y opcionalmente `ANTHROPIC_MODEL`, por defecto `claude-opus-5-5`). El nodo **Agente IA** recibe instrucciones de sistema, el mensaje y, si se desea, el historial de la conversación; guarda la respuesta en `{{vars.<nombre>}}` y puede contestar al cliente directamente. Si el modelo rechaza una petición, la API reintenta automáticamente con un modelo de respaldo (`fallbacks: "default"`).

## Automatizaciones

**Disparadores**: mensaje recibido (por canal y palabras clave), contacto creado, etiqueta añadida, llamada finalizada (por estado), webhook entrante (`POST /hooks/<clave>`, crea/vincula el contacto por `phone`/`email`) y ejecución manual.

**Pasos**: enviar mensaje (por cualquier canal o el de la conversación, con plantilla), condición (sí/no), esperar, variable, agente IA, petición HTTP, servicio externo, añadir/quitar etiqueta, actualizar contacto, asignar agente (fijo o reparto equitativo), cerrar conversación y fin. Los pasos de IA/HTTP tienen una salida **Error** opcional para manejar fallos. Cada ejecución guarda un log por paso que se puede ver resaltado sobre el lienzo.

## API

Todas las rutas bajo `/api` (salvo `/api/auth/*`) requieren `Authorization: Bearer <token>`.

| Recurso | Rutas principales |
| --- | --- |
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/switch` |
| Contactos | `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/:id`, `POST /contacts/import`, `POST /contacts/bulk-tag`, `POST /contacts/:id/verify` |
| Etiquetas / Segmentos | `/tags`, `/segments`, `POST /segments/preview` |
| Conversaciones | `GET /conversations`, `POST /conversations/start`, `GET /conversations/:id`, `POST /conversations/:id/messages`, `PATCH /conversations/:id` |
| Plantillas | `/templates`, `POST /templates/preview` |
| Campañas | `/campaigns`, `POST /campaigns/audience-preview`, `POST /campaigns/:id/launch`, `POST /campaigns/:id/pause` |
| Telefonía | `GET /calls/token`, `GET /calls`, `PATCH /calls/:id` |
| Proveedores | `GET /connections/providers`, `/connections`, `POST /connections/:id/test`, `PUT /connections/routing/:channel` |
| WhatsApp Web | `GET /whatsapp/sessions`, `POST /whatsapp/sessions/:id/start`, `POST /whatsapp/sessions/:id/logout` |
| Automatizaciones | `/workflows`, `POST /workflows/:id/toggle`, `POST /workflows/:id/run`, `GET /workflows/:id/runs` |
| Webhooks públicos | `/webhooks/twilio/:id/*`, `/webhooks/meta/:id`, `/webhooks/email/:id/inbound`, `/hooks/:key` |

## Tests

```bash
createdb nexus_test   # una vez
(cd apps/api && DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus_test npx prisma migrate deploy)
npm test
```

Cubren aislamiento multi-tenant, importación y segmentación, envío y recepción, failover entre proveedores, ocultación de secretos, opt-out, campañas, automatizaciones (ramas, esperas, webhooks) y los webhooks de Twilio (SMS y voz) y Meta.

## Próximos pasos sugeridos

- Cola distribuida (BullMQ/Redis) para escalar el scheduler a varias instancias.
- Más adaptadores: Vonage, Telnyx, 360dialog, Amazon SES, Telegram, Instagram/Messenger.
- Sincronización del estado de aprobación de plantillas con WhatsApp Manager.
- Invitaciones por correo y SSO; facturación por workspace.
