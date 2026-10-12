import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { notFound } from "../lib/errors.js";

export const tagsRouter = Router();
const input = z.object({ name: z.string().min(1).max(50), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });

tagsRouter.get(
  "/",
  ah(async (req, res) => {
    const tags = await prisma.tag.findMany({
      where: { workspaceId: req.auth.workspaceId },
      include: { _count: { select: { contacts: true } } },
      orderBy: { name: "asc" },
    });
    res.json(tags);
  }),
);

tagsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = input.parse(req.body);
    res.status(201).json(await prisma.tag.create({ data: { ...body, workspaceId: req.auth.workspaceId } }));
  }),
);

tagsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = input.partial().parse(req.body);
    const r = await prisma.tag.updateMany({ where: { id: req.params.id, workspaceId: req.auth.workspaceId }, data: body });
    if (!r.count) throw notFound("Etiqueta");
    res.json(await prisma.tag.findUnique({ where: { id: req.params.id } }));
  }),
);

tagsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    await prisma.tag.deleteMany({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    res.status(204).end();
  }),
);
