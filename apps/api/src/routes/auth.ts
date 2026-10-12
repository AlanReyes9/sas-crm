import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { HttpError } from "../lib/errors.js";
import { encryptJson } from "../lib/crypto.js";
import { requireAuth, signToken } from "../middleware/auth.js";

export const authRouter = Router();

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";

authRouter.post(
  "/register",
  ah(async (req, res) => {
    const body = z
      .object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), company: z.string().min(2) })
      .parse(req.body);
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, "Ese email ya está registrado");
    let slug = slugify(body.company);
    if (await prisma.workspace.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;

    const { user, workspace } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name: body.name, passwordHash: await bcrypt.hash(body.password, 10) },
      });
      const workspace = await tx.workspace.create({ data: { name: body.company, slug } });
      await tx.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" } });
      // Cada workspace nuevo arranca con el proveedor sandbox para poder probar todo sin credenciales.
      await tx.providerConnection.create({
        data: { workspaceId: workspace.id, provider: "mock", name: "Sandbox", credentials: encryptJson({}) },
      });
      return { user, workspace };
    });
    res.status(201).json({
      token: signToken({ userId: user.id, workspaceId: workspace.id }),
      user: { id: user.id, name: user.name, email: user.email },
      workspace,
    });
  }),
);

authRouter.post(
  "/login",
  ah(async (req, res) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      include: { memberships: { include: { workspace: true } } },
    });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new HttpError(401, "Credenciales incorrectas");
    }
    const membership = user.memberships[0];
    if (!membership) throw new HttpError(403, "El usuario no pertenece a ningún workspace");
    res.json({
      token: signToken({ userId: user.id, workspaceId: membership.workspaceId }),
      user: { id: user.id, name: user.name, email: user.email },
      workspace: membership.workspace,
    });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.auth.userId },
      include: { memberships: { include: { workspace: true } } },
    });
    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      role: req.auth.role,
      workspace: user.memberships.find((m) => m.workspaceId === req.auth.workspaceId)?.workspace,
      workspaces: user.memberships.map((m) => ({ ...m.workspace, role: m.role })),
    });
  }),
);

authRouter.post(
  "/switch",
  requireAuth,
  ah(async (req, res) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.body);
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: req.auth.userId, workspaceId } },
    });
    if (!m) throw new HttpError(403, "Sin acceso a ese workspace");
    res.json({ token: signToken({ userId: req.auth.userId, workspaceId }) });
  }),
);
