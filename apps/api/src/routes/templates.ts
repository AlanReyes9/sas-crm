import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { notFound } from "../lib/errors.js";
import { extractVariables, render } from "../lib/template.js";
import { contactContext } from "../services/messaging.js";

export const templatesRouter = Router();

const input = z.object({
  name: z.string().min(1).max(80),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).default("MARKETING"),
  language: z.string().default("es"),
  subject: z.string().nullish(),
  body: z.string().min(1).max(4096),
  html: z.string().nullish(),
  externalId: z.string().nullish(),
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED"]).default("APPROVED"),
});

templatesRouter.get(
  "/",
  ah(async (req, res) => {
    const channel = z.enum(["WHATSAPP", "SMS", "EMAIL"]).optional().parse(req.query.channel || undefined);
    const items = await prisma.template.findMany({
      where: { workspaceId: req.auth.workspaceId, ...(channel ? { channel } : {}) },
      orderBy: { updatedAt: "desc" },
    });
    res.json(items.map((t) => ({ ...t, variables: extractVariables(`${t.subject ?? ""} ${t.body}`) })));
  }),
);

templatesRouter.post(
  "/",
  ah(async (req, res) => {
    const body = input.parse(req.body);
    res.status(201).json(await prisma.template.create({ data: { ...body, workspaceId: req.auth.workspaceId } }));
  }),
);

templatesRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = input.partial().parse(req.body);
    const r = await prisma.template.updateMany({ where: { id: req.params.id, workspaceId: req.auth.workspaceId }, data: body });
    if (!r.count) throw notFound("Plantilla");
    res.json(await prisma.template.findUnique({ where: { id: req.params.id } }));
  }),
);

templatesRouter.delete(
  "/:id",
  ah(async (req, res) => {
    await prisma.template.deleteMany({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    res.status(204).end();
  }),
);

/** Renderiza una plantilla con los datos de un contacto (o de ejemplo). */
templatesRouter.post(
  "/preview",
  ah(async (req, res) => {
    const { body, subject, contactId } = z
      .object({ body: z.string(), subject: z.string().optional(), contactId: z.string().optional() })
      .parse(req.body);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: req.auth.workspaceId } });
    const contact = contactId
      ? await prisma.contact.findFirst({ where: { id: contactId, workspaceId: req.auth.workspaceId } })
      : null;
    const ctx = contact
      ? contactContext(contact, { workspace: { name: workspace.name } })
      : {
          contact: { firstName: "Ana", lastName: "García", fullName: "Ana García", email: "ana@ejemplo.com", phone: "+5215512345678", company: "Acme" },
          workspace: { name: workspace.name },
        };
    res.json({ body: render(body, ctx), subject: subject ? render(subject, ctx) : undefined, variables: extractVariables(body) });
  }),
);
