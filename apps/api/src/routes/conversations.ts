import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { notFound } from "../lib/errors.js";
import { emitToWorkspace } from "../lib/realtime.js";
import { sendToContact } from "../services/messaging.js";

export const conversationsRouter = Router();
const channelEnum = z.enum(["WHATSAPP", "SMS", "EMAIL"]);

conversationsRouter.get(
  "/",
  ah(async (req, res) => {
    const q = z
      .object({
        status: z.enum(["OPEN", "PENDING", "CLOSED", "ALL"]).default("OPEN"),
        channel: channelEnum.optional(),
        assigned: z.enum(["me", "unassigned", "all"]).default("all"),
        q: z.string().optional(),
        take: z.coerce.number().max(200).default(100),
      })
      .parse(req.query);
    const where: Prisma.ConversationWhereInput = { workspaceId: req.auth.workspaceId };
    if (q.status !== "ALL") where.status = q.status;
    if (q.channel) where.channel = q.channel;
    if (q.assigned === "me") where.assigneeId = req.auth.userId;
    if (q.assigned === "unassigned") where.assigneeId = null;
    if (q.q) {
      where.OR = [
        { contact: { firstName: { contains: q.q, mode: "insensitive" } } },
        { contact: { lastName: { contains: q.q, mode: "insensitive" } } },
        { contact: { phone: { contains: q.q } } },
        { contact: { email: { contains: q.q, mode: "insensitive" } } },
        { lastPreview: { contains: q.q, mode: "insensitive" } },
      ];
    }
    const items = await prisma.conversation.findMany({
      where,
      include: { contact: true, assignee: { select: { id: true, name: true } } },
      orderBy: { lastMessageAt: "desc" },
      take: q.take,
    });
    res.json(items);
  }),
);

/** Inicia (o reutiliza) una conversación con un contacto y envía el primer mensaje. */
conversationsRouter.post(
  "/start",
  ah(async (req, res) => {
    const body = z
      .object({
        contactId: z.string(),
        channel: channelEnum,
        body: z.string().optional(),
        subject: z.string().optional(),
        templateId: z.string().optional(),
      })
      .parse(req.body);
    const message = await sendToContact({ workspaceId: req.auth.workspaceId, ...body, metadata: { userId: req.auth.userId } });
    res.status(201).json(message);
  }),
);

async function owned(workspaceId: string, id: string) {
  const conv = await prisma.conversation.findFirst({ where: { id, workspaceId }, include: { contact: true } });
  if (!conv) throw notFound("Conversación");
  return conv;
}

conversationsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const conv = await owned(req.auth.workspaceId, req.params.id);
    const messages = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    // Otras conversaciones del mismo contacto (vista unificada multicanal)
    const siblings = await prisma.conversation.findMany({
      where: { contactId: conv.contactId, id: { not: conv.id } },
      select: { id: true, channel: true, lastMessageAt: true, unreadCount: true },
    });
    res.json({ conversation: conv, messages, siblings });
  }),
);

conversationsRouter.post(
  "/:id/messages",
  ah(async (req, res) => {
    const body = z
      .object({
        body: z.string().optional(),
        subject: z.string().optional(),
        templateId: z.string().optional(),
        mediaUrl: z.string().url().optional(),
      })
      .parse(req.body);
    const conv = await owned(req.auth.workspaceId, req.params.id);
    const message = await sendToContact({
      workspaceId: req.auth.workspaceId,
      contactId: conv.contactId,
      channel: conv.channel,
      ...body,
      metadata: { userId: req.auth.userId },
    });
    res.status(201).json(message);
  }),
);

conversationsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = z
      .object({ status: z.enum(["OPEN", "PENDING", "CLOSED"]).optional(), assigneeId: z.string().nullable().optional() })
      .parse(req.body);
    await owned(req.auth.workspaceId, req.params.id);
    const conv = await prisma.conversation.update({ where: { id: req.params.id }, data: body, include: { contact: true } });
    emitToWorkspace(req.auth.workspaceId, "conversation:update", conv);
    res.json(conv);
  }),
);

conversationsRouter.post(
  "/:id/read",
  ah(async (req, res) => {
    await owned(req.auth.workspaceId, req.params.id);
    const conv = await prisma.conversation.update({ where: { id: req.params.id }, data: { unreadCount: 0 } });
    emitToWorkspace(req.auth.workspaceId, "conversation:update", conv);
    res.json(conv);
  }),
);
