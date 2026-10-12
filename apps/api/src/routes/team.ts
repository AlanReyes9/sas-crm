import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { badRequest } from "../lib/errors.js";
import { requireRole } from "../middleware/auth.js";

export const teamRouter = Router();

teamRouter.get(
  "/",
  ah(async (req, res) => {
    const members = await prisma.membership.findMany({
      where: { workspaceId: req.auth.workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.json(members.map((m) => ({ id: m.id, role: m.role, name: m.user.name, email: m.user.email, userId: m.user.id })));
  }),
);

/** Añade un miembro. Si el usuario no existe se crea con una contraseña temporal. */
teamRouter.post(
  "/",
  requireRole("OWNER", "ADMIN"),
  ah(async (req, res) => {
    const body = z
      .object({ email: z.string().email(), name: z.string().min(1), role: z.enum(["ADMIN", "AGENT"]).default("AGENT") })
      .parse(req.body);
    const email = body.email.toLowerCase();
    let user = await prisma.user.findUnique({ where: { email } });
    let tempPassword: string | undefined;
    if (!user) {
      tempPassword = crypto.randomBytes(6).toString("base64url");
      user = await prisma.user.create({ data: { email, name: body.name, passwordHash: await bcrypt.hash(tempPassword, 10) } });
    }
    const exists = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: req.auth.workspaceId } },
    });
    if (exists) throw badRequest("Ya es miembro del workspace");
    await prisma.membership.create({ data: { userId: user.id, workspaceId: req.auth.workspaceId, role: body.role } });
    res.status(201).json({ userId: user.id, email, tempPassword });
  }),
);

teamRouter.delete(
  "/:membershipId",
  requireRole("OWNER", "ADMIN"),
  ah(async (req, res) => {
    const m = await prisma.membership.findFirst({ where: { id: req.params.membershipId, workspaceId: req.auth.workspaceId } });
    if (!m) throw badRequest("Miembro no encontrado");
    if (m.role === "OWNER") throw badRequest("No se puede eliminar al propietario");
    await prisma.membership.delete({ where: { id: m.id } });
    res.status(204).end();
  }),
);
