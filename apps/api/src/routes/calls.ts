import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { badRequest, notFound } from "../lib/errors.js";
import { adapterFor, voiceConnection } from "../services/connections.js";

export const callsRouter = Router();

/** Identidad del agente en el SDK de voz. Formato: u_<userId> */
export const agentIdentity = (userId: string) => `u_${userId}`;

/** Token de acceso para el softphone del navegador. */
callsRouter.get(
  "/token",
  ah(async (req, res) => {
    const conn = await voiceConnection(req.auth.workspaceId);
    const adapter = adapterFor(conn);
    if (!adapter.voice) throw badRequest(`El proveedor ${conn.provider} no soporta voz`);
    res.json({
      token: adapter.voice.createAccessToken(agentIdentity(req.auth.userId)),
      identity: agentIdentity(req.auth.userId),
      provider: conn.provider,
      connectionId: conn.id,
      callerId: adapter.voice.callerId(),
    });
  }),
);

callsRouter.get(
  "/",
  ah(async (req, res) => {
    const q = z.object({ contactId: z.string().optional(), take: z.coerce.number().max(200).default(100) }).parse(req.query);
    const calls = await prisma.call.findMany({
      where: { workspaceId: req.auth.workspaceId, ...(q.contactId ? { contactId: q.contactId } : {}) },
      include: { contact: { select: { id: true, firstName: true, lastName: true } }, user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: q.take,
    });
    res.json(calls);
  }),
);

/**
 * Registro manual de una llamada simulada (proveedor sandbox), para probar
 * historial y automatizaciones sin Twilio.
 */
callsRouter.post(
  "/simulate",
  ah(async (req, res) => {
    const body = z
      .object({ to: z.string(), contactId: z.string().optional(), duration: z.number().int().min(0).default(42) })
      .parse(req.body);
    const conn = await voiceConnection(req.auth.workspaceId);
    if (conn.provider !== "mock") throw badRequest("Solo disponible con el proveedor sandbox");
    const call = await prisma.call.create({
      data: {
        workspaceId: req.auth.workspaceId,
        userId: req.auth.userId,
        contactId: body.contactId,
        direction: "OUTBOUND",
        from: "+15005550006",
        to: body.to,
        status: "COMPLETED",
        duration: body.duration,
        endedAt: new Date(),
      },
    });
    res.status(201).json(call);
  }),
);

callsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = z.object({ notes: z.string().nullable().optional(), contactId: z.string().nullable().optional() }).parse(req.body);
    const r = await prisma.call.updateMany({ where: { id: req.params.id, workspaceId: req.auth.workspaceId }, data: body });
    if (!r.count) throw notFound("Llamada");
    res.json(await prisma.call.findUnique({ where: { id: req.params.id } }));
  }),
);
