import nodemailer from "nodemailer";
import dns from "node:dns/promises";
import { isEmail } from "../lib/phone.js";
import { ProviderError, type ProviderAdapter, type ProviderDefinition, type VerifyResult } from "./types.js";

const fromFields = [
  { key: "fromEmail", label: "Email remitente", required: true, placeholder: "hola@tuempresa.com" },
  { key: "fromName", label: "Nombre remitente", placeholder: "Tu Empresa" },
  { key: "replyTo", label: "Responder a" },
];

const toHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`)
    .join("");

/** Comprobación de sintaxis + registros MX del dominio. */
export async function verifyEmailAddress(address: string): Promise<VerifyResult> {
  if (!isEmail(address)) return { status: "INVALID", detail: { reason: "Formato inválido" } };
  const domain = address.split("@")[1];
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx.length) return { status: "INVALID", detail: { reason: "El dominio no tiene registros MX" } };
    return { status: "VALID", detail: { mx: mx.sort((a, b) => a.priority - b.priority)[0].exchange } };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return { status: "INVALID", detail: { reason: "Dominio inexistente" } };
    return { status: "UNKNOWN", detail: { reason: code } };
  }
}

function fromHeader(settings: Record<string, unknown>) {
  const email = String(settings.fromEmail ?? "");
  const name = settings.fromName ? String(settings.fromName) : "";
  return name ? `${name} <${email}>` : email;
}

function base(provider: string, send: ProviderAdapter["send"], test: ProviderAdapter["test"]): ProviderAdapter {
  return {
    async send(msg) {
      if (msg.channel !== "EMAIL") throw new ProviderError(provider, `Canal ${msg.channel} no soportado`);
      return send(msg);
    },
    test,
    verifyAddress: async (_c, address) => verifyEmailAddress(address),
  };
}

async function httpJson(provider: string, url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  if (!res.ok) throw new ProviderError(provider, `${res.status} ${text.slice(0, 300)}`, res.status >= 500 || res.status === 429);
  return { res, data };
}

export const smtpProvider: ProviderDefinition = {
  key: "smtp",
  label: "SMTP",
  description: "Cualquier servidor SMTP (Gmail, Outlook, Amazon SES, Postmark, tu propio servidor...).",
  channels: ["EMAIL"],
  credentialFields: [
    { key: "host", label: "Host", required: true, placeholder: "smtp.tuproveedor.com" },
    { key: "port", label: "Puerto", required: true, placeholder: "587" },
    { key: "user", label: "Usuario" },
    { key: "pass", label: "Contraseña", type: "password" },
  ],
  settingsFields: [...fromFields, { key: "secure", label: "TLS directo (puerto 465)", type: "boolean" }],
  create(ctx) {
    const c = ctx.credentials;
    const transport = nodemailer.createTransport({
      host: c.host,
      port: Number(c.port || 587),
      secure: Boolean(ctx.settings.secure),
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    });
    return base(
      "smtp",
      async (msg) => {
        const info = await transport.sendMail({
          from: fromHeader(ctx.settings),
          replyTo: (ctx.settings.replyTo as string) || undefined,
          to: msg.to,
          subject: msg.subject ?? "(sin asunto)",
          text: msg.body,
          html: msg.html ?? toHtml(msg.body),
        });
        return { providerMessageId: info.messageId, status: "SENT" };
      },
      async () => {
        try {
          await transport.verify();
          return { ok: true, detail: "Conexión SMTP verificada" };
        } catch (e) {
          return { ok: false, detail: (e as Error).message };
        }
      },
    );
  },
};

export const sendgridProvider: ProviderDefinition = {
  key: "sendgrid",
  label: "SendGrid",
  description: "Correo transaccional y marketing con Twilio SendGrid.",
  channels: ["EMAIL"],
  credentialFields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
  settingsFields: fromFields,
  create(ctx) {
    const headers = { Authorization: `Bearer ${ctx.credentials.apiKey}`, "Content-Type": "application/json" };
    return base(
      "sendgrid",
      async (msg) => {
        const { res } = await httpJson("sendgrid", "https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers,
          body: JSON.stringify({
            personalizations: [{ to: [{ email: msg.to }] }],
            from: { email: ctx.settings.fromEmail, name: ctx.settings.fromName || undefined },
            reply_to: ctx.settings.replyTo ? { email: ctx.settings.replyTo } : undefined,
            subject: msg.subject ?? "(sin asunto)",
            content: [
              { type: "text/plain", value: msg.body },
              { type: "text/html", value: msg.html ?? toHtml(msg.body) },
            ],
          }),
        });
        return { providerMessageId: res.headers.get("x-message-id") ?? undefined, status: "SENT" };
      },
      async () => {
        try {
          await httpJson("sendgrid", "https://api.sendgrid.com/v3/scopes", { headers });
          return { ok: true, detail: "API Key válida" };
        } catch (e) {
          return { ok: false, detail: (e as Error).message };
        }
      },
    );
  },
};

export const resendProvider: ProviderDefinition = {
  key: "resend",
  label: "Resend",
  description: "API de correo moderna para desarrolladores.",
  channels: ["EMAIL"],
  credentialFields: [{ key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "re_..." }],
  settingsFields: fromFields,
  create(ctx) {
    const headers = { Authorization: `Bearer ${ctx.credentials.apiKey}`, "Content-Type": "application/json" };
    return base(
      "resend",
      async (msg) => {
        const { data } = await httpJson("resend", "https://api.resend.com/emails", {
          method: "POST",
          headers,
          body: JSON.stringify({
            from: fromHeader(ctx.settings),
            to: [msg.to],
            reply_to: ctx.settings.replyTo || undefined,
            subject: msg.subject ?? "(sin asunto)",
            text: msg.body,
            html: msg.html ?? toHtml(msg.body),
          }),
        });
        return { providerMessageId: data.id as string, status: "SENT" };
      },
      async () => {
        try {
          await httpJson("resend", "https://api.resend.com/domains", { headers });
          return { ok: true, detail: "API Key válida" };
        } catch (e) {
          return { ok: false, detail: (e as Error).message };
        }
      },
    );
  },
};

export const mailgunProvider: ProviderDefinition = {
  key: "mailgun",
  label: "Mailgun",
  description: "Envío de correo con Mailgun (regiones US/EU).",
  channels: ["EMAIL"],
  credentialFields: [
    { key: "apiKey", label: "API Key", type: "password", required: true },
    { key: "domain", label: "Dominio", required: true, placeholder: "mg.tuempresa.com" },
  ],
  settingsFields: [
    ...fromFields,
    { key: "region", label: "Región", type: "select", options: [{ value: "us", label: "US" }, { value: "eu", label: "EU" }] },
  ],
  webhooks: (id) => [{ label: "Inbound route (forward)", path: `/webhooks/email/${id}/inbound` }],
  create(ctx) {
    const host = ctx.settings.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
    const auth = "Basic " + Buffer.from(`api:${ctx.credentials.apiKey}`).toString("base64");
    const domain = ctx.credentials.domain;
    return base(
      "mailgun",
      async (msg) => {
        const form = new URLSearchParams({
          from: fromHeader(ctx.settings),
          to: msg.to,
          subject: msg.subject ?? "(sin asunto)",
          text: msg.body,
          html: msg.html ?? toHtml(msg.body),
        });
        const { data } = await httpJson("mailgun", `${host}/v3/${domain}/messages`, {
          method: "POST",
          headers: { Authorization: auth },
          body: form,
        });
        return { providerMessageId: String(data.id ?? "").replace(/[<>]/g, ""), status: "QUEUED" };
      },
      async () => {
        try {
          await httpJson("mailgun", `${host}/v3/domains/${domain}`, { headers: { Authorization: auth } });
          return { ok: true, detail: `Dominio ${domain} accesible` };
        } catch (e) {
          return { ok: false, detail: (e as Error).message };
        }
      },
    );
  },
};
