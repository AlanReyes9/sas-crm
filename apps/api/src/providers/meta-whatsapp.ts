import crypto from "node:crypto";
import { ProviderError, type ProviderDefinition } from "./types.js";

/**
 * WhatsApp Business Cloud API (Meta). Envía texto libre (dentro de la ventana de 24 h)
 * y plantillas aprobadas (fuera de la ventana).
 */
export const metaWhatsAppProvider: ProviderDefinition = {
  key: "meta_whatsapp",
  label: "Meta WhatsApp Cloud API",
  description: "API oficial de WhatsApp Business alojada por Meta. Plantillas aprobadas y webhooks.",
  channels: ["WHATSAPP"],
  credentialFields: [
    { key: "accessToken", label: "Access Token (System User)", type: "password", required: true },
    { key: "appSecret", label: "App Secret", type: "password", help: "Valida la firma de los webhooks" },
    { key: "verifyToken", label: "Verify Token del webhook", required: true, help: "Cualquier texto; el mismo que pongas en Meta" },
  ],
  settingsFields: [
    { key: "phoneNumberId", label: "Phone Number ID", required: true },
    { key: "wabaId", label: "WhatsApp Business Account ID" },
    { key: "apiVersion", label: "Versión de Graph API", placeholder: "v21.0" },
  ],
  webhooks: (id) => [{ label: "Callback URL (Webhooks → whatsapp_business_account)", path: `/webhooks/meta/${id}` }],
  create(ctx) {
    const { accessToken } = ctx.credentials;
    const phoneNumberId = String(ctx.settings.phoneNumberId ?? "");
    const version = String(ctx.settings.apiVersion || "v21.0");
    const base = `https://graph.facebook.com/${version}`;

    async function graph(path: string, init?: RequestInit) {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init?.headers },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const msg = (data.error as { message?: string } | undefined)?.message ?? res.statusText;
        throw new ProviderError("meta_whatsapp", msg, res.status >= 500 || res.status === 429);
      }
      return data;
    }

    return {
      async send(msg) {
        const to = msg.to.replace(/^\+/, "");
        let payload: Record<string, unknown>;
        if (msg.template) {
          payload = {
            type: "template",
            template: {
              name: msg.template.name,
              language: { code: msg.template.language },
              components: msg.template.variables.length
                ? [{ type: "body", parameters: msg.template.variables.map((text) => ({ type: "text", text })) }]
                : [],
            },
          };
        } else if (msg.mediaUrl) {
          payload = { type: "image", image: { link: msg.mediaUrl, caption: msg.body } };
        } else {
          payload = { type: "text", text: { body: msg.body, preview_url: true } };
        }
        const data = await graph(`/${phoneNumberId}/messages`, {
          method: "POST",
          body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
        });
        const id = (data.messages as { id: string }[] | undefined)?.[0]?.id;
        return { providerMessageId: id, status: "SENT", raw: data };
      },
      async test() {
        try {
          const d = await graph(`/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
          return { ok: true, detail: `${d.verified_name} (${d.display_phone_number})` };
        } catch (e) {
          return { ok: false, detail: (e as Error).message };
        }
      },
    };
  },
};

/** Verifica X-Hub-Signature-256 usando el App Secret. */
export function verifyMetaSignature(appSecret: string, rawBody: Buffer, signature: string | undefined) {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export const mapMetaStatus = (s: string) =>
  (({ sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" }) as const)[s as "sent"] ?? "SENT";
