import { Router } from "express";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { badRequest, notFound } from "../lib/errors.js";
import { getWhatsAppWebState, logoutWhatsAppWeb, startWhatsAppWeb } from "../providers/whatsapp-web.js";

/** Gestión de sesiones de WhatsApp Web (vinculación por QR). */
export const whatsappRouter = Router();

async function waConnection(workspaceId: string, id: string) {
  const conn = await prisma.providerConnection.findFirst({ where: { id, workspaceId } });
  if (!conn) throw notFound("Conexión");
  if (conn.provider !== "whatsapp_web") throw badRequest("La conexión no es de WhatsApp Web");
  return conn;
}

whatsappRouter.get(
  "/sessions",
  ah(async (req, res) => {
    const conns = await prisma.providerConnection.findMany({
      where: { workspaceId: req.auth.workspaceId, provider: { in: ["whatsapp_web", "meta_whatsapp", "twilio"] } },
      orderBy: { createdAt: "asc" },
    });
    res.json(
      conns.map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        status: c.status,
        settings: c.settings,
        live: c.provider === "whatsapp_web" ? getWhatsAppWebState(c.id) : null,
      })),
    );
  }),
);

whatsappRouter.post(
  "/sessions/:id/start",
  ah(async (req, res) => {
    const conn = await waConnection(req.auth.workspaceId, req.params.id);
    const s = await startWhatsAppWeb(conn.id, conn.workspaceId);
    res.json({ status: s.status, qr: s.qr });
  }),
);

whatsappRouter.get(
  "/sessions/:id/state",
  ah(async (req, res) => {
    const conn = await waConnection(req.auth.workspaceId, req.params.id);
    res.json(getWhatsAppWebState(conn.id));
  }),
);

whatsappRouter.post(
  "/sessions/:id/logout",
  ah(async (req, res) => {
    const conn = await waConnection(req.auth.workspaceId, req.params.id);
    await logoutWhatsAppWeb(conn.id);
    await prisma.providerConnection.update({ where: { id: conn.id }, data: { status: "disconnected" } });
    res.json({ ok: true });
  }),
);
