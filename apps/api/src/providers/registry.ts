import type { Channel } from "@prisma/client";
import { mockProvider } from "./mock.js";
import { twilioProvider } from "./twilio.js";
import { metaWhatsAppProvider } from "./meta-whatsapp.js";
import { whatsappWebProvider } from "./whatsapp-web.js";
import { mailgunProvider, resendProvider, sendgridProvider, smtpProvider } from "./email.js";
import type { ProviderDefinition } from "./types.js";
import { isServerless } from "../lib/background.js";

/**
 * Catálogo de proveedores. Para añadir uno nuevo (Vonage, Plivo, Telnyx, 360dialog,
 * Postmark, Amazon SES...) basta con implementar ProviderDefinition y registrarlo aquí.
 */
const providers: ProviderDefinition[] = [
  twilioProvider,
  metaWhatsAppProvider,
  // WhatsApp Web mantiene un WebSocket abierto y sesiones en disco: no cabe en funciones serverless.
  ...(isServerless ? [] : [whatsappWebProvider]),
  smtpProvider,
  sendgridProvider,
  resendProvider,
  mailgunProvider,
  mockProvider,
];

const byKey = new Map(providers.map((p) => [p.key, p]));

export const getProvider = (key: string) => byKey.get(key);
export const listProviders = () => providers;
export const providersForChannel = (channel: Channel) => providers.filter((p) => p.channels.includes(channel));
