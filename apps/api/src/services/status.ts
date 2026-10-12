import type { MessageStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { emitToWorkspace } from "../lib/realtime.js";

const rank: Record<MessageStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4, RECEIVED: 0 };

/** Actualiza el estado de un mensaje a partir del id del proveedor (webhooks de estado). */
export async function updateMessageStatusByProviderId(providerMessageId: string, status: MessageStatus, error?: string) {
  const msg = await prisma.message.findFirst({
    where: { providerMessageId },
    include: { conversation: { select: { workspaceId: true } } },
  });
  if (!msg) return;
  // Los webhooks pueden llegar desordenados: nunca retroceder (salvo a FAILED).
  if (status !== "FAILED" && rank[status] <= rank[msg.status]) return;
  const updated = await prisma.message.update({
    where: { id: msg.id },
    data: { status, error: error ?? msg.error },
  });
  const recipientStatus = status === "FAILED" ? "FAILED" : status === "DELIVERED" || status === "READ" ? "DELIVERED" : null;
  if (recipientStatus) {
    await prisma.campaignRecipient.updateMany({ where: { messageId: msg.id }, data: { status: recipientStatus, error } });
  }
  emitToWorkspace(msg.conversation.workspaceId, "message:status", {
    id: updated.id,
    conversationId: updated.conversationId,
    status: updated.status,
    error: updated.error,
  });
}
