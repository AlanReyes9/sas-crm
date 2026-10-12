import type { Channel } from "@prisma/client";
import { prisma } from "../db.js";
import { getPath, render, renderDeep } from "../lib/template.js";
import { emitToWorkspace } from "../lib/realtime.js";
import { sendToContact } from "../services/messaging.js";
import { bus } from "../services/events.js";
import { runAgent } from "./ai.js";
import type { NodeResult, RunContext, WorkflowNode } from "./types.js";

type Handler = (node: WorkflowNode, ctx: RunContext) => Promise<NodeResult>;

const tpl = (s: unknown, ctx: RunContext) => render(String(s ?? ""), ctx as unknown as Record<string, unknown>);

function requireContact(ctx: RunContext) {
  if (!ctx.contact?.id) throw new Error("Este nodo necesita un contacto en el contexto");
  return ctx.contact.id as string;
}

/** Evalúa una condición simple: left op right (ambos admiten variables). */
export function evaluateCondition(c: { left: string; op: string; right?: string }, ctx: RunContext): boolean {
  const left = tpl(c.left, ctx).trim();
  const right = tpl(c.right ?? "", ctx).trim();
  const l = left.toLowerCase();
  const r = right.toLowerCase();
  switch (c.op) {
    case "equals":
      return l === r;
    case "not_equals":
      return l !== r;
    case "contains":
      return r.split(",").map((x) => x.trim()).filter(Boolean).some((x) => l.includes(x));
    case "not_contains":
      return !r.split(",").map((x) => x.trim()).filter(Boolean).some((x) => l.includes(x));
    case "starts_with":
      return l.startsWith(r);
    case "is_empty":
      return l === "";
    case "is_not_empty":
      return l !== "";
    case "gt":
      return Number(left) > Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "matches":
      try {
        return new RegExp(right, "i").test(left);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

const UNIT_MS: Record<string, number> = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

async function httpCall(method: string, url: string, headers: Record<string, string>, body?: string) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "User-Agent": "CRM-NEXUS-Automations/1.0", ...headers },
    body: method === "GET" || method === "DELETE" ? undefined : body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* respuesta no JSON */
  }
  return { status: res.status, ok: res.ok, data };
}

export const nodeHandlers: Record<string, Handler> = {
  async trigger() {
    return { log: "Disparador" };
  },

  async send_message(node, ctx) {
    const contactId = requireContact(ctx);
    const channel = (node.data.channel === "same" || !node.data.channel
      ? ctx.conversation?.channel ?? "WHATSAPP"
      : node.data.channel) as Channel;
    const msg = await sendToContact({
      workspaceId: ctx.workspaceId,
      contactId,
      channel,
      templateId: node.data.templateId || undefined,
      body: node.data.templateId ? undefined : tpl(node.data.body, ctx),
      subject: node.data.subject ? tpl(node.data.subject, ctx) : undefined,
      variables: ctx.vars,
      metadata: { automation: true },
    });
    if (msg.status === "FAILED") throw new Error(`Envío fallido: ${msg.error}`);
    return { log: `Mensaje enviado por ${channel} (${msg.status})` };
  },

  async condition(node, ctx) {
    const conditions = (node.data.conditions ?? []) as { left: string; op: string; right?: string }[];
    const results = conditions.map((c) => evaluateCondition(c, ctx));
    const pass = node.data.match === "any" ? results.some(Boolean) : results.every(Boolean);
    return { handle: pass ? "true" : "false", log: `Condición → ${pass ? "verdadero" : "falso"}` };
  },

  async wait(node) {
    const ms = Number(node.data.amount ?? 1) * (UNIT_MS[node.data.unit ?? "minutes"] ?? 60_000);
    return { waitUntil: new Date(Date.now() + ms), log: `Esperando ${node.data.amount} ${node.data.unit ?? "minutes"}` };
  },

  async webhook(node, ctx) {
    const method = String(node.data.method ?? "POST").toUpperCase();
    const url = tpl(node.data.url, ctx);
    if (!/^https?:\/\//.test(url)) throw new Error("URL de webhook inválida");
    const headers = renderDeep(parseJson(node.data.headers, {}), ctx as unknown as Record<string, unknown>) as Record<string, string>;
    const body = node.data.body
      ? tpl(node.data.body, ctx)
      : JSON.stringify({ contact: ctx.contact, message: ctx.message, vars: ctx.vars, trigger: ctx.trigger.type });
    const res = await httpCall(method, url, headers, body);
    if (node.data.saveAs) ctx.vars[node.data.saveAs] = res.data;
    if (!res.ok && !node.data.continueOnError) throw new Error(`HTTP ${res.status}`);
    return { handle: res.ok ? undefined : "error", log: `${method} ${url} → ${res.status}` };
  },

  async integration(node, ctx) {
    // Conectores preconfigurados con servicios externos.
    const service = String(node.data.service ?? "custom");
    const url = tpl(node.data.url, ctx);
    const text = tpl(node.data.message ?? "", ctx);
    const payloads: Record<string, unknown> = {
      slack: { text },
      discord: { content: text },
      teams: { text },
      google_sheets: { row: [new Date().toISOString(), ctx.contact?.fullName, ctx.contact?.phone, ctx.contact?.email, text] },
    };
    const body = payloads[service] ?? { event: ctx.trigger.type, text, contact: ctx.contact, message: ctx.message, vars: ctx.vars };
    const res = await httpCall("POST", url, {}, JSON.stringify(body));
    if (!res.ok) throw new Error(`${service}: HTTP ${res.status}`);
    return { log: `Enviado a ${service}` };
  },

  async ai_agent(node, ctx) {
    let history: { role: "user" | "assistant"; content: string }[] = [];
    if (node.data.includeHistory !== false && ctx.conversation?.id) {
      const last = await prisma.message.findMany({
        where: { conversationId: ctx.conversation.id, ...(ctx.message?.id ? { id: { not: ctx.message.id } } : {}) },
        orderBy: { createdAt: "desc" },
        take: Number(node.data.historySize ?? 10),
      });
      history = last.reverse().map((m) => ({ role: m.direction === "INBOUND" ? "user" : "assistant", content: m.body }));
    }
    const system =
      tpl(node.data.system || "Eres un asistente de atención al cliente amable y conciso. Responde en el idioma del cliente.", ctx) +
      `\n\nDatos del contacto: ${JSON.stringify({ nombre: ctx.contact?.fullName, email: ctx.contact?.email, empresa: ctx.contact?.company })}`;
    const output = await runAgent({
      system,
      history,
      prompt: tpl(node.data.prompt || "{{message.body}}", ctx),
      model: node.data.model || undefined,
      effort: node.data.effort || undefined,
    });
    ctx.vars[node.data.saveAs || "ai"] = output;
    if (node.data.reply && ctx.contact?.id) {
      await sendToContact({
        workspaceId: ctx.workspaceId,
        contactId: ctx.contact.id,
        channel: (ctx.conversation?.channel ?? "WHATSAPP") as Channel,
        body: output,
        metadata: { automation: true, ai: true },
      });
    }
    return { log: `IA → ${output.slice(0, 80)}${output.length > 80 ? "…" : ""}` };
  },

  async add_tag(node, ctx) {
    const contactId = requireContact(ctx);
    const name = tpl(node.data.tagName, ctx).trim();
    if (!name) throw new Error("Etiqueta vacía");
    const tag = await prisma.tag.upsert({
      where: { workspaceId_name: { workspaceId: ctx.workspaceId, name } },
      create: { workspaceId: ctx.workspaceId, name },
      update: {},
    });
    const existed = await prisma.contactTag.findUnique({ where: { contactId_tagId: { contactId, tagId: tag.id } } });
    if (!existed) {
      await prisma.contactTag.create({ data: { contactId, tagId: tag.id } });
      const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
      bus.emitEvent("tag.added", { workspaceId: ctx.workspaceId, contact, tagName: name });
    }
    return { log: `Etiqueta "${name}" añadida` };
  },

  async remove_tag(node, ctx) {
    const contactId = requireContact(ctx);
    const name = tpl(node.data.tagName, ctx).trim();
    await prisma.contactTag.deleteMany({ where: { contactId, tag: { name, workspaceId: ctx.workspaceId } } });
    return { log: `Etiqueta "${name}" quitada` };
  },

  async update_contact(node, ctx) {
    const contactId = requireContact(ctx);
    const field = String(node.data.field ?? "");
    const value = tpl(node.data.value, ctx);
    const direct = ["firstName", "lastName", "email", "phone", "whatsapp", "company", "notes"];
    if (direct.includes(field)) {
      await prisma.contact.update({ where: { id: contactId }, data: { [field]: value } });
    } else {
      const c = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
      const key = field.replace(/^custom\./, "");
      await prisma.contact.update({
        where: { id: contactId },
        data: { customFields: { ...(c.customFields as object), [key]: value } },
      });
    }
    if (ctx.contact) ctx.contact[field.replace(/^custom\./, "")] = value;
    return { log: `${field} = ${value}` };
  },

  async set_variable(node, ctx) {
    const value = node.data.path ? getPath(ctx, tpl(node.data.path, ctx)) : tpl(node.data.value, ctx);
    ctx.vars[node.data.name] = value;
    return { log: `vars.${node.data.name} = ${JSON.stringify(value)?.slice(0, 60)}` };
  },

  async assign(node, ctx) {
    if (!ctx.conversation?.id) throw new Error("No hay conversación que asignar");
    let assigneeId: string | null = node.data.userId || null;
    if (node.data.mode === "round_robin") {
      const members = await prisma.membership.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { id: "asc" } });
      const counts = await Promise.all(
        members.map((m) => prisma.conversation.count({ where: { assigneeId: m.userId, status: "OPEN" } })),
      );
      assigneeId = members[counts.indexOf(Math.min(...counts))]?.userId ?? null;
    }
    const conv = await prisma.conversation.update({ where: { id: ctx.conversation.id }, data: { assigneeId } });
    emitToWorkspace(ctx.workspaceId, "conversation:update", conv);
    return { log: `Conversación asignada` };
  },

  async close_conversation(_node, ctx) {
    if (!ctx.conversation?.id) return { log: "Sin conversación" };
    const conv = await prisma.conversation.update({ where: { id: ctx.conversation.id }, data: { status: "CLOSED" } });
    emitToWorkspace(ctx.workspaceId, "conversation:update", conv);
    return { log: "Conversación cerrada" };
  },

  async end() {
    return { stop: true, log: "Fin" };
  },
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
