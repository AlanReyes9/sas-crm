import type { Contact } from "@prisma/client";
import { prisma } from "../db.js";
import { bus } from "../services/events.js";
import { buildContext, startRun, triggerNode } from "./engine.js";
import type { RunContext, TriggerType, WorkflowGraph } from "./types.js";

/** Lanza todos los workflows activos de un tipo de disparador cuyos filtros coinciden. */
export async function fireTrigger(
  workspaceId: string,
  type: TriggerType,
  contact: Contact | null,
  extra: Partial<RunContext>,
  matches: (data: Record<string, any>) => boolean = () => true, // eslint-disable-line @typescript-eslint/no-explicit-any
) {
  const workflows = await prisma.workflow.findMany({ where: { workspaceId, triggerType: type, active: true } });
  const runs = [];
  for (const wf of workflows) {
    const t = triggerNode(wf.graph as unknown as WorkflowGraph);
    if (!t || !matches(t.data ?? {})) continue;
    const ctx = buildContext(workspaceId, { type, payload: extra.trigger?.payload }, contact, extra);
    runs.push(await startRun(wf, ctx));
  }
  return runs;
}

const keywordMatch = (body: string, keywords?: string) => {
  if (!keywords?.trim()) return true;
  const text = body.toLowerCase();
  return keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => text.includes(k));
};

export function registerAutomationTriggers() {
  bus.onEvent("message.received", async ({ workspaceId, contact, conversation, message }) => {
    await fireTrigger(
      workspaceId,
      "message_received",
      contact,
      {
        conversation: { id: conversation.id, channel: conversation.channel },
        message: { id: message.id, body: message.body, channel: message.channel, subject: message.subject },
      },
      (d) => (!d.channel || d.channel === "ANY" || d.channel === message.channel) && keywordMatch(message.body, d.keywords),
    );
  });

  bus.onEvent("contact.created", async ({ workspaceId, contact }) => {
    await fireTrigger(workspaceId, "contact_created", contact, {});
  });

  bus.onEvent("tag.added", async ({ workspaceId, contact, tagName }) => {
    await fireTrigger(workspaceId, "tag_added", contact, { vars: { tag: tagName } }, (d) =>
      !d.tagName || String(d.tagName).toLowerCase() === tagName.toLowerCase(),
    );
  });

  bus.onEvent("call.completed", async ({ workspaceId, call, contact }) => {
    await fireTrigger(
      workspaceId,
      "call_completed",
      contact,
      { vars: { call: { status: call.status, duration: call.duration, direction: call.direction } } },
      (d) => !d.callStatus || d.callStatus === "ANY" || d.callStatus === call.status,
    );
  });
}
