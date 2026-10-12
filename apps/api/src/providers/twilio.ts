import twilio from "twilio";
import { config } from "../config.js";
import { ProviderError, type ProviderDefinition } from "./types.js";

const statusMap: Record<string, "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  accepted: "QUEUED",
  queued: "QUEUED",
  sending: "QUEUED",
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  undelivered: "FAILED",
  failed: "FAILED",
};
export const mapTwilioStatus = (s: string) => statusMap[s] ?? "SENT";

/**
 * Twilio: SMS, WhatsApp (vía Twilio) y voz en el navegador (Voice JS SDK).
 * Para voz se necesita una API Key y una TwiML App cuyo Voice URL apunte a
 * {PUBLIC_URL}/webhooks/twilio/:connectionId/voice
 */
export const twilioProvider: ProviderDefinition = {
  key: "twilio",
  label: "Twilio",
  description: "SMS, WhatsApp y llamadas desde el navegador con Twilio Programmable Voice.",
  channels: ["SMS", "WHATSAPP", "VOICE"],
  credentialFields: [
    { key: "accountSid", label: "Account SID", required: true, placeholder: "AC..." },
    { key: "authToken", label: "Auth Token", type: "password", required: true },
    { key: "apiKeySid", label: "API Key SID (voz)", placeholder: "SK...", help: "Necesario para llamadas desde el navegador" },
    { key: "apiKeySecret", label: "API Key Secret (voz)", type: "password" },
    { key: "twimlAppSid", label: "TwiML App SID (voz)", placeholder: "AP..." },
  ],
  settingsFields: [
    { key: "smsFrom", label: "Número remitente SMS", placeholder: "+15551234567" },
    { key: "whatsappFrom", label: "Número WhatsApp (Twilio)", placeholder: "+14155238886" },
    { key: "voiceCallerId", label: "Caller ID para llamadas", placeholder: "+15551234567" },
    { key: "messagingServiceSid", label: "Messaging Service SID (opcional)", placeholder: "MG..." },
    { key: "recordCalls", label: "Grabar llamadas", type: "boolean" },
  ],
  webhooks: (id) => [
    { label: "SMS / WhatsApp entrantes (A message comes in)", path: `/webhooks/twilio/${id}/inbound` },
    { label: "Estado de mensajes (status callback)", path: `/webhooks/twilio/${id}/status` },
    { label: "Voice URL de la TwiML App y del número", path: `/webhooks/twilio/${id}/voice` },
  ],
  create(ctx) {
    const { accountSid, authToken, apiKeySid, apiKeySecret, twimlAppSid } = ctx.credentials;
    const client = twilio(accountSid, authToken);
    const s = ctx.settings as Record<string, string | undefined>;
    const statusCallback = `${config.publicUrl}/webhooks/twilio/${ctx.connectionId}/status`;

    return {
      async send(msg) {
        if (msg.channel !== "SMS" && msg.channel !== "WHATSAPP") {
          throw new ProviderError("twilio", `Canal ${msg.channel} no soportado para mensajes`);
        }
        const isWa = msg.channel === "WHATSAPP";
        const from = isWa ? s.whatsappFrom : s.smsFrom;
        if (!from && !s.messagingServiceSid) {
          throw new ProviderError("twilio", `Configura el número remitente para ${msg.channel}`);
        }
        try {
          const res = await client.messages.create({
            to: isWa ? `whatsapp:${msg.to}` : msg.to,
            ...(s.messagingServiceSid && !isWa
              ? { messagingServiceSid: s.messagingServiceSid }
              : { from: isWa ? `whatsapp:${from}` : from }),
            body: msg.body,
            ...(msg.mediaUrl ? { mediaUrl: [msg.mediaUrl] } : {}),
            statusCallback,
          });
          return { providerMessageId: res.sid, status: mapTwilioStatus(res.status), raw: { sid: res.sid } };
        } catch (e) {
          const err = e as { message: string; status?: number };
          throw new ProviderError("twilio", err.message, (err.status ?? 500) >= 500 || err.status === 429);
        }
      },
      async test() {
        try {
          const acc = await client.api.v2010.accounts(accountSid).fetch();
          return { ok: true, detail: `Cuenta ${acc.friendlyName} (${acc.status})` };
        } catch (e) {
          return { ok: false, detail: (e as Error).message };
        }
      },
      async verifyAddress(channel, address) {
        if (channel === "EMAIL") return { status: "UNKNOWN" };
        try {
          const r = await client.lookups.v2.phoneNumbers(address).fetch({ fields: "line_type_intelligence" });
          const lineType = (r.lineTypeIntelligence as { type?: string } | null)?.type;
          if (!r.valid) return { status: "INVALID", detail: { reason: r.validationErrors } };
          // Los fijos no reciben SMS/WhatsApp
          const reachable = channel === "VOICE" || lineType !== "landline";
          return {
            status: reachable ? "VALID" : "INVALID",
            detail: { lineType, carrier: r.lineTypeIntelligence, country: r.countryCode },
          };
        } catch (e) {
          return { status: "UNKNOWN", detail: { error: (e as Error).message } };
        }
      },
      voice: {
        createAccessToken(identity) {
          if (!apiKeySid || !apiKeySecret || !twimlAppSid) {
            throw new ProviderError("twilio", "Faltan API Key / TwiML App para llamadas desde el navegador");
          }
          const { AccessToken } = twilio.jwt;
          const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity, ttl: 3600 });
          token.addGrant(
            new AccessToken.VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: true }),
          );
          return token.toJwt();
        },
        callerId: () => s.voiceCallerId ?? s.smsFrom,
      },
    };
  },
};

/** Valida la firma X-Twilio-Signature de un webhook. */
export function validateTwilioSignature(authToken: string, signature: string, url: string, params: Record<string, string>) {
  return twilio.validateRequest(authToken, signature, url, params);
}

export const VoiceResponse = twilio.twiml.VoiceResponse;
