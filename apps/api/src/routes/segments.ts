import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { badRequest, notFound } from "../lib/errors.js";
import { rulesSchema, rulesToWhere } from "../services/segments.js";

export const segmentsRouter = Router();
const input = z.object({ name: z.string().min(1), description: z.string().nullish(), rules: rulesSchema });

function safeWhere(workspaceId: string, rules: unknown) {
  try {
    return rulesToWhere(workspaceId, rules);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
}

segmentsRouter.get(
  "/",
  ah(async (req, res) => {
    const { workspaceId } = req.auth;
    const segments = await prisma.segment.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
    const withCounts = await Promise.all(
      segments.map(async (s) => ({ ...s, count: await prisma.contact.count({ where: safeWhere(workspaceId, s.rules) }) })),
    );
    res.json(withCounts);
  }),
);

segmentsRouter.post(
  "/preview",
  ah(async (req, res) => {
    const { rules } = z.object({ rules: rulesSchema }).parse(req.body);
    const where = safeWhere(req.auth.workspaceId, rules);
    const [count, sample] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({ where, take: 10, orderBy: { createdAt: "desc" } }),
    ]);
    res.json({ count, sample });
  }),
);

segmentsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = input.parse(req.body);
    safeWhere(req.auth.workspaceId, body.rules);
    res.status(201).json(await prisma.segment.create({ data: { ...body, workspaceId: req.auth.workspaceId } }));
  }),
);

segmentsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = input.partial().parse(req.body);
    if (body.rules) safeWhere(req.auth.workspaceId, body.rules);
    const r = await prisma.segment.updateMany({ where: { id: req.params.id, workspaceId: req.auth.workspaceId }, data: body });
    if (!r.count) throw notFound("Segmento");
    res.json(await prisma.segment.findUnique({ where: { id: req.params.id } }));
  }),
);

segmentsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    await prisma.segment.deleteMany({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    res.status(204).end();
  }),
);
