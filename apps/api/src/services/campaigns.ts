import type { Campaign, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { emitToWorkspace } from "../lib/realtime.js";
import { addressFor, sendToContact } from "./messaging.js";
import { rulesToWhere } from "./segments.js";

export const audienceSchema = z.object({
  segmentIds: z.array(z.string()).default([]),
  tagIds: z.array(z.string()).default([]),
  contactIds: z.array(z.string()).default([]),
  all: z.boolean().default(false),
});
export type Audience = z.infer<typeof audienceSchema>;

/** Resuelve la audiencia (unión de segmentos, etiquetas y contactos sueltos). */
export async function resolveAudience(workspaceId: string, raw: unknown) {
  const a = audienceSchema.parse(raw ?? {});
  if (a.all) return prisma.contact.findMany({ where: { workspaceId } });
  const or: Prisma.ContactWhereInput[] = [];
  if (a.contactIds.length) or.push({ id: { in: a.contactIds } });
  if (a.tagIds.length) or.push({ tags: { some: { tagId: { in: a.tagIds } } } });
  if (a.segmentIds.length) {
    const segments = await prisma.segment.findMany({ where: { workspaceId, id: { in: a.segmentIds } } });
    for (const s of segments) or.push(rulesToWhere(workspaceId, s.rules));
  }
  if (!or.length) return [];
  return prisma.contact.findMany({ where: { workspaceId, OR: or } });
}

/** Prepara destinatarios y pone la campaña en marcha. */
export async function launchCampaign(campaign: Campaign) {
  if (!["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status)) {
    throw new HttpError(400, `No se puede lanzar una campaña en estado ${campaign.status}`);
  }
  if (campaign.status !== "PAUSED") {
    const contacts = await resolveAudience(campaign.workspaceId, campaign.audience);
    if (!contacts.length) throw new HttpError(400, "La audiencia está vacía");
    await prisma.campaignRecipient.createMany({
      data: contacts.map((c) => {
        const skip = (c.optOut && campaign.channel !== "EMAIL") || !addressFor(c, campaign.channel);
        return {
          campaignId: campaign.id,
          contactId: c.id,
          status: skip ? ("SKIPPED" as const) : ("PENDING" as const),
          error: skip ? (c.optOut ? "Opt-out" : "Sin dirección para el canal") : null,
        };
      }),
      skipDuplicates: true,
    });
  }
  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "RUNNING", startedAt: campaign.startedAt ?? new Date() },
  });
  emitToWorkspace(campaign.workspaceId, "campaign:update", { id: campaign.id, status: "RUNNING" });
  return updated;
}

const running = new Set<string>();

/** Procesa un lote de una campaña respetando su límite por minuto. Llamado por el scheduler. */
export async function processCampaignBatch(campaign: Campaign, tickSeconds: number) {
  if (running.has(campaign.id)) return;
  running.add(campaign.id);
  try {
    const batch = Math.max(1, Math.round((campaign.ratePerMin * tickSeconds) / 60));
    const pending = await prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id, status: "PENDING" },
      take: batch,
    });
    if (!pending.length) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      emitToWorkspace(campaign.workspaceId, "campaign:update", { id: campaign.id, status: "COMPLETED" });
      return;
    }
    for (const r of pending) {
      try {
        const msg = await sendToContact({
          workspaceId: campaign.workspaceId,
          contactId: r.contactId,
          channel: campaign.channel,
          templateId: campaign.templateId ?? undefined,
          body: campaign.body ?? undefined,
          subject: campaign.subject ?? undefined,
          metadata: { campaignId: campaign.id },
        });
        await prisma.campaignRecipient.update({
          where: { id: r.id },
          data: {
            status: msg.status === "FAILED" ? "FAILED" : msg.status === "DELIVERED" ? "DELIVERED" : "SENT",
            messageId: msg.id,
            error: msg.error,
            sentAt: new Date(),
          },
        });
      } catch (e) {
        await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: (e as Error).message } });
      }
    }
    emitToWorkspace(campaign.workspaceId, "campaign:progress", { id: campaign.id });
  } finally {
    running.delete(campaign.id);
  }
}

export async function campaignStats(campaignId: string) {
  const groups = await prisma.campaignRecipient.groupBy({ by: ["status"], where: { campaignId }, _count: true });
  const stats = { total: 0, PENDING: 0, SENT: 0, DELIVERED: 0, FAILED: 0, SKIPPED: 0 };
  for (const g of groups) {
    stats[g.status] = g._count;
    stats.total += g._count;
  }
  return stats;
}
