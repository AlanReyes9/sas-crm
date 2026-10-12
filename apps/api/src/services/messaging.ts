import type { Channel, Contact, Message, Template } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { emitToWorkspace } from "../lib/realtime.js";
import { extractVariables, render } from "../lib/template.js";
import { toE164 } from "../lib/phone.js";
import { ProviderError, type OutboundMessage } from "../providers/types.js";
import { adapterFor, connectionsForChannel } from "./connections.js";
import { bus } from "./events.js";

export const OPT_OUT_KEYWORDS = ["stop", "baja", "cancelar", "unsubscribe", "alto"];

/** Dirección de un contacto para un canal. */
export function addressFor(contact: Contact, channel: Channel): string | null {
  if (channel === "EMAIL") return contact.email || null;
  if (channel === "WHATSAPP") return contact.whatsapp || contact.phone || null;
  return contact.phone || null;
}

/** Contexto de variables disponible en plantillas y automatizaciones. */
export function contactContext(contact: Contact, extra: Record<string, unknown> = {}) {
  return {
    contact: {
      ...contact,
      ...(contact.customFields as Record<string, unknown>),
      fullName: `${contact.firstName} ${contact.lastName}`.trim(),
    },
    ...extra,
  };
}

export async function ensureConversation(workspaceId: string, contactId: string, channel: Channel, connectionId?: string) {
  return prisma.conversation.upsert({
    where: { workspaceId_contactId_channel: { workspaceId, contactId, channel } },
    create: { workspaceId, contactId, channel, connectionId },
    update: connectionId ? { connectionId } : {},
  });
}

export interface SendOptions {
  workspaceId: string;
  contactId: string;
  channel: Channel;
  body?: string;
  subject?: string;
  html?: string;
  mediaUrl?: string;
  templateId?: string;
  /** Variables adicionales para renderizar ({{vars.x}}) */
  variables?: Record<string, unknown>;
  /** Forzar una conexión concreta (p. ej. responder por el mismo número). */
  connectionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Envía un mensaje a un contacto por el canal indicado, eligiendo el proveedor
 * según el enrutamiento del workspace. Si el primer proveedor falla con un error
 * reintentable, prueba con el siguiente (failover).
 */
export async function sendToContact(opts: SendOptions): Promise<Message> {
  const contact = await prisma.contact.findFirst({ where: { id: opts.contactId, workspaceId: opts.workspaceId } });
  if (!contact) throw new HttpError(404, "Contacto no encontrado");
  if (opts.channel === "VOICE") throw new HttpError(400, "Usa el módulo de Telefonía para llamadas");

  let template: Template | null = null;
  if (opts.templateId) {
    template = await prisma.template.findFirst({ where: { id: opts.templateId, workspaceId: opts.workspaceId } });
    if (!template) throw new HttpError(404, "Plantilla no encontrada");
  }
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: opts.workspaceId } });
  const ctx = contactContext(contact, { workspace: { name: workspace.name }, vars: opts.variables ?? {} });
  const rawBody = template?.body ?? opts.body ?? "";
  const body = render(rawBody, ctx);
  const subject = render(template?.subject ?? opts.subject ?? "", ctx) || undefined;
  const html = template?.html ? render(template.html, ctx) : opts.html;
  if (!body.trim() && !opts.mediaUrl) throw new HttpError(400, "El mensaje está vacío");

  const to = addressFor(contact, opts.channel);
  const conversation = await ensureConversation(opts.workspaceId, contact.id, opts.channel);
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      channel: opts.channel,
      body,
      subject,
      mediaUrl: opts.mediaUrl,
      status: "QUEUED",
      metadata: { ...(opts.metadata ?? {}), templateId: template?.id } as object,
    },
  });

  const fail = async (error: string) => {
    const m = await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED", error } });
    await touchConversation(conversation.id, opts.workspaceId, m);
    return m;
  };

  if (contact.optOut && opts.channel !== "EMAIL") return fail("El contacto se dio de baja (opt-out)");
  if (!to) return fail(`El contacto no tiene dirección para ${opts.channel}`);

  let connections = await connectionsForChannel(opts.workspaceId, opts.channel);
  const preferred = opts.connectionId ?? conversation.connectionId;
  if (preferred) {
    connections = [...connections.filter((c) => c.id === preferred), ...connections.filter((c) => c.id !== preferred)];
  }
  if (!connections.length) return fail(`No hay proveedor configurado para ${opts.channel}`);

  const outbound: OutboundMessage = { channel: opts.channel, to, body, subject, html, mediaUrl: opts.mediaUrl };
  const errors: string[] = [];
  for (const conn of connections) {
    try {
      const adapter = adapterFor(conn);
      const useTemplate = template?.externalId && conn.provider === "meta_whatsapp";
      const result = await adapter.send({
        ...outbound,
        template: useTemplate
          ? {
              name: template!.externalId!,
              language: template!.language,
              variables: extractVariables(template!.body).map((v) => render(`{{${v}}}`, ctx)),
            }
          : undefined,
      });
      const sent = await prisma.message.update({
        where: { id: message.id },
        data: {
          status: result.status,
          provider: conn.provider,
          providerMessageId: result.providerMessageId,
          error: errors.length ? `Failover: ${errors.join(" | ")}` : null,
        },
      });
      await touchConversation(conversation.id, opts.workspaceId, sent, conn.id);
      return sent;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      // Solo hacemos failover en errores reintentables o de configuración de ese proveedor.
      if (e instanceof ProviderError || !(e instanceof HttpError)) continue;
      break;
    }
  }
  return fail(errors.join(" | "));
}

async function touchConversation(conversationId: string, workspaceId: string, message: Message, connectionId?: string) {
  const conv = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: message.createdAt,
      lastPreview: message.body.slice(0, 140),
      ...(connectionId ? { connectionId } : {}),
      ...(message.direction === "OUTBOUND" ? { status: "OPEN" } : {}),
    },
  });
  emitToWorkspace(workspaceId, "message:new", { message, conversation: conv });
}

export interface InboundInput {
  workspaceId: string;
  channel: Channel;
  from: string;
  body: string;
  subject?: string;
  mediaUrl?: string;
  connectionId?: string;
  provider?: string;
  providerMessageId?: string;
  profileName?: string;
  metadata?: Record<string, unknown>;
}

/** Busca o crea el contacto que corresponde a un remitente. */
export async function findOrCreateContact(workspaceId: string, channel: Channel, from: string, profileName?: string) {
  const isEmail = channel === "EMAIL";
  const address = isEmail ? from.toLowerCase().trim() : toE164(from) ?? from;
  const existing = await prisma.contact.findFirst({
    where: isEmail
      ? { workspaceId, email: { equals: address, mode: "insensitive" } }
      : { workspaceId, OR: [{ phone: address }, { whatsapp: address }] },
  });
  if (existing) return { contact: existing, created: false };
  const [firstName, ...rest] = (profileName ?? "").trim().split(/\s+/);
  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      firstName: firstName ?? "",
      lastName: rest.join(" "),
      ...(isEmail ? { email: address } : channel === "WHATSAPP" ? { phone: address, whatsapp: address } : { phone: address }),
    },
  });
  bus.emitEvent("contact.created", { workspaceId, contact });
  return { contact, created: true };
}

/** Registra un mensaje entrante desde cualquier proveedor. */
export async function recordInbound(input: InboundInput) {
  if (input.providerMessageId) {
    const dup = await prisma.message.findFirst({ where: { providerMessageId: input.providerMessageId, direction: "INBOUND" } });
    if (dup) return dup; // los proveedores reintentan webhooks
  }
  let { contact } = await findOrCreateContact(input.workspaceId, input.channel, input.from, input.profileName);

  if (OPT_OUT_KEYWORDS.includes(input.body.trim().toLowerCase())) {
    contact = await prisma.contact.update({ where: { id: contact.id }, data: { optOut: true } });
  }

  const conversation = await ensureConversation(input.workspaceId, contact.id, input.channel, input.connectionId);
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      channel: input.channel,
      body: input.body,
      subject: input.subject,
      mediaUrl: input.mediaUrl,
      status: "RECEIVED",
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      metadata: (input.metadata ?? {}) as object,
    },
  });
  const conv = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      unreadCount: { increment: 1 },
      lastMessageAt: message.createdAt,
      lastPreview: message.body.slice(0, 140),
      status: "OPEN",
    },
  });
  emitToWorkspace(input.workspaceId, "message:new", { message, conversation: conv, contact });
  bus.emitEvent("message.received", { workspaceId: input.workspaceId, contact, conversation: conv, message });
  return message;
}
