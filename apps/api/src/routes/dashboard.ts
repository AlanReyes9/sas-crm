import { Router } from "express";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/",
  ah(async (req, res) => {
    const { workspaceId } = req.auth;
    const since = new Date(Date.now() - 14 * 86400000);
    const [contacts, openConversations, unread, activeWorkflows, runningCampaigns, callsToday, byChannel, daily, connections] =
      await Promise.all([
        prisma.contact.count({ where: { workspaceId } }),
        prisma.conversation.count({ where: { workspaceId, status: "OPEN" } }),
        prisma.conversation.aggregate({ where: { workspaceId }, _sum: { unreadCount: true } }),
        prisma.workflow.count({ where: { workspaceId, active: true } }),
        prisma.campaign.count({ where: { workspaceId, status: "RUNNING" } }),
        prisma.call.count({ where: { workspaceId, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
        prisma.$queryRaw<{ channel: string; direction: string; count: bigint }[]>`
          SELECT m."channel", m."direction", COUNT(*)::bigint AS count
          FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
          WHERE c."workspaceId" = ${workspaceId} AND m."createdAt" >= ${since}
          GROUP BY m."channel", m."direction"`,
        prisma.$queryRaw<{ day: Date; inbound: bigint; outbound: bigint }[]>`
          SELECT date_trunc('day', m."createdAt") AS day,
                 COUNT(*) FILTER (WHERE m."direction" = 'INBOUND')::bigint AS inbound,
                 COUNT(*) FILTER (WHERE m."direction" = 'OUTBOUND')::bigint AS outbound
          FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
          WHERE c."workspaceId" = ${workspaceId} AND m."createdAt" >= ${since}
          GROUP BY 1 ORDER BY 1`,
        prisma.providerConnection.findMany({ where: { workspaceId }, select: { id: true, name: true, provider: true, status: true } }),
      ]);
    res.json({
      contacts,
      openConversations,
      unread: unread._sum.unreadCount ?? 0,
      activeWorkflows,
      runningCampaigns,
      callsToday,
      byChannel: byChannel.map((r) => ({ ...r, count: Number(r.count) })),
      daily: daily.map((r) => ({ day: r.day, inbound: Number(r.inbound), outbound: Number(r.outbound) })),
      connections,
    });
  }),
);
