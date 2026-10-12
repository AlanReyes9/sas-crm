import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { badRequest, notFound } from "../lib/errors.js";
import { audienceSchema, campaignStats, launchCampaign, resolveAudience } from "../services/campaigns.js";

export const campaignsRouter = Router();

const input = z.object({
  name: z.string().min(1),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  templateId: z.string().nullish(),
  body: z.string().nullish(),
  subject: z.string().nullish(),
  audience: audienceSchema,
  scheduledAt: z.coerce.date().nullish(),
  ratePerMin: z.number().int().min(1).max(6000).default(60),
});

async function owned(workspaceId: string, id: string) {
  const c = await prisma.campaign.findFirst({ where: { id, workspaceId } });
  if (!c) throw notFound("Campaña");
  return c;
}

campaignsRouter.get(
  "/",
  ah(async (req, res) => {
    const items = await prisma.campaign.findMany({
      where: { workspaceId: req.auth.workspaceId },
      include: { template: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(await Promise.all(items.map(async (c) => ({ ...c, stats: await campaignStats(c.id) }))));
  }),
);

campaignsRouter.post(
  "/audience-preview",
  ah(async (req, res) => {
    const { audience, channel } = z
      .object({ audience: audienceSchema, channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]) })
      .parse(req.body);
    const contacts = await resolveAudience(req.auth.workspaceId, audience);
    const reachable = contacts.filter((c) =>
      channel === "EMAIL" ? !!c.email : !c.optOut && !!(channel === "WHATSAPP" ? c.whatsapp || c.phone : c.phone),
    );
    res.json({ total: contacts.length, reachable: reachable.length });
  }),
);

campaignsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = input.parse(req.body);
    if (!body.templateId && !body.body) throw badRequest("Elige una plantilla o escribe un mensaje");
    const campaign = await prisma.campaign.create({
      data: { ...body, workspaceId: req.auth.workspaceId, status: body.scheduledAt ? "SCHEDULED" : "DRAFT" },
    });
    res.status(201).json(campaign);
  }),
);

campaignsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const c = await prisma.campaign.findFirst({
      where: { id: req.params.id, workspaceId: req.auth.workspaceId },
      include: { template: true },
    });
    if (!c) throw notFound("Campaña");
    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId: c.id },
      include: { contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } } },
      orderBy: { sentAt: "desc" },
      take: 200,
    });
    res.json({ ...c, stats: await campaignStats(c.id), recipients });
  }),
);

campaignsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const c = await owned(req.auth.workspaceId, req.params.id);
    if (!["DRAFT", "SCHEDULED"].includes(c.status)) throw badRequest("Solo se pueden editar borradores o programadas");
    const body = input.partial().parse(req.body);
    const status = body.scheduledAt === undefined ? c.status : body.scheduledAt ? "SCHEDULED" : "DRAFT";
    res.json(await prisma.campaign.update({ where: { id: c.id }, data: { ...body, status } }));
  }),
);

campaignsRouter.post(
  "/:id/launch",
  ah(async (req, res) => {
    const c = await owned(req.auth.workspaceId, req.params.id);
    res.json(await launchCampaign(c));
  }),
);

campaignsRouter.post(
  "/:id/pause",
  ah(async (req, res) => {
    const c = await owned(req.auth.workspaceId, req.params.id);
    if (c.status !== "RUNNING") throw badRequest("La campaña no está en ejecución");
    res.json(await prisma.campaign.update({ where: { id: c.id }, data: { status: "PAUSED" } }));
  }),
);

campaignsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const c = await owned(req.auth.workspaceId, req.params.id);
    if (c.status === "RUNNING") throw badRequest("Pausa la campaña antes de eliminarla");
    await prisma.campaign.delete({ where: { id: c.id } });
    res.status(204).end();
  }),
);
