import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { badRequest, notFound } from "../lib/errors.js";
import { toE164 } from "../lib/phone.js";
import { bus } from "../services/events.js";
import { rulesToWhere } from "../services/segments.js";
import { verifyContactChannels } from "../services/verification.js";

export const contactsRouter = Router();

const channelEnum = z.enum(["WHATSAPP", "SMS", "EMAIL", "VOICE"]);

const contactInput = z.object({
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  email: z.string().email().nullish().or(z.literal("")),
  phone: z.string().nullish(),
  whatsapp: z.string().nullish(),
  company: z.string().nullish(),
  notes: z.string().nullish(),
  customFields: z.record(z.unknown()).optional(),
  optOut: z.boolean().optional(),
  tags: z.array(z.string()).optional(), // nombres de etiqueta
});

function normalize(data: Partial<z.infer<typeof contactInput>>) {
  const out: Record<string, unknown> = { ...data };
  delete out.tags;
  if ("email" in data) out.email = data.email ? data.email.toLowerCase().trim() : null;
  for (const k of ["phone", "whatsapp"] as const) {
    if (k in data) {
      const raw = data[k];
      if (raw) {
        const e164 = toE164(raw);
        if (!e164) throw badRequest(`Número inválido en ${k}: ${raw}`);
        out[k] = e164;
      } else out[k] = null;
    }
  }
  return out;
}

async function setTagsByName(workspaceId: string, contactId: string, names: string[]) {
  for (const name of names.map((n) => n.trim()).filter(Boolean)) {
    const tag = await prisma.tag.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name },
      update: {},
    });
    const exists = await prisma.contactTag.findUnique({ where: { contactId_tagId: { contactId, tagId: tag.id } } });
    if (!exists) {
      const contact = await prisma.contactTag
        .create({ data: { contactId, tagId: tag.id }, include: { contact: true } })
        .then((ct) => ct.contact);
      bus.emitEvent("tag.added", { workspaceId, contact, tagName: name });
    }
  }
}

const include = {
  tags: { include: { tag: true } },
  verifications: true,
} satisfies Prisma.ContactInclude;

contactsRouter.get(
  "/",
  ah(async (req, res) => {
    const q = z
      .object({
        q: z.string().optional(),
        tagId: z.string().optional(),
        segmentId: z.string().optional(),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query);
    const { workspaceId } = req.auth;
    const and: Prisma.ContactWhereInput[] = [{ workspaceId }];
    if (q.q) {
      and.push({
        OR: ["firstName", "lastName", "email", "phone", "company"].map((f) => ({
          [f]: { contains: q.q, mode: "insensitive" },
        })),
      });
    }
    if (q.tagId) and.push({ tags: { some: { tagId: q.tagId } } });
    if (q.segmentId) {
      const seg = await prisma.segment.findFirst({ where: { id: q.segmentId, workspaceId } });
      if (!seg) throw notFound("Segmento");
      and.push(rulesToWhere(workspaceId, seg.rules));
    }
    const where = { AND: and };
    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.contact.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

contactsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = contactInput.parse(req.body);
    const { workspaceId } = req.auth;
    const contact = await prisma.contact.create({ data: { ...(normalize(body) as object), workspaceId } as never });
    bus.emitEvent("contact.created", { workspaceId, contact });
    if (body.tags?.length) await setTagsByName(workspaceId, contact.id, body.tags);
    res.status(201).json(await prisma.contact.findUnique({ where: { id: contact.id }, include }));
  }),
);

/** Importación masiva (filas ya parseadas desde CSV en el cliente). Deduplica por teléfono/email. */
contactsRouter.post(
  "/import",
  ah(async (req, res) => {
    const { rows, tags } = z
      .object({ rows: z.array(contactInput.partial()).max(5000), tags: z.array(z.string()).default([]) })
      .parse(req.body);
    const { workspaceId } = req.auth;
    let created = 0;
    let updated = 0;
    const errors: { row: number; error: string }[] = [];
    for (const [i, row] of rows.entries()) {
      try {
        const data = normalize(row) as Record<string, string | null>;
        const or: Prisma.ContactWhereInput[] = [];
        if (data.phone) or.push({ phone: data.phone });
        if (data.email) or.push({ email: data.email });
        if (!or.length) throw new Error("La fila no tiene teléfono ni email");
        const existing = await prisma.contact.findFirst({ where: { workspaceId, OR: or } });
        const contact = existing
          ? await prisma.contact.update({ where: { id: existing.id }, data: data as never })
          : await prisma.contact.create({ data: { ...data, workspaceId } as never });
        if (existing) updated++;
        else {
          created++;
          bus.emitEvent("contact.created", { workspaceId, contact });
        }
        const allTags = [...tags, ...(row.tags ?? [])];
        if (allTags.length) await setTagsByName(workspaceId, contact.id, allTags);
      } catch (e) {
        errors.push({ row: i + 1, error: (e as Error).message });
      }
    }
    res.json({ created, updated, errors });
  }),
);

contactsRouter.post(
  "/bulk-tag",
  ah(async (req, res) => {
    const { contactIds, tags, remove } = z
      .object({ contactIds: z.array(z.string()).min(1), tags: z.array(z.string()).min(1), remove: z.boolean().default(false) })
      .parse(req.body);
    const { workspaceId } = req.auth;
    const owned = await prisma.contact.findMany({ where: { workspaceId, id: { in: contactIds } }, select: { id: true } });
    for (const { id } of owned) {
      if (remove) await prisma.contactTag.deleteMany({ where: { contactId: id, tag: { name: { in: tags }, workspaceId } } });
      else await setTagsByName(workspaceId, id, tags);
    }
    res.json({ updated: owned.length });
  }),
);

contactsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, workspaceId: req.auth.workspaceId },
      include: {
        ...include,
        conversations: { orderBy: { lastMessageAt: "desc" } },
        calls: { orderBy: { createdAt: "desc" }, take: 20 },
        recipients: { include: { campaign: { select: { id: true, name: true, channel: true } } }, take: 20 },
      },
    });
    if (!contact) throw notFound("Contacto");
    res.json(contact);
  }),
);

contactsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = contactInput.partial().parse(req.body);
    const { workspaceId } = req.auth;
    const existing = await prisma.contact.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!existing) throw notFound("Contacto");
    const data = normalize(body);
    if (body.customFields) data.customFields = { ...(existing.customFields as object), ...body.customFields };
    await prisma.contact.update({ where: { id: existing.id }, data: data as never });
    if (body.tags) {
      await prisma.contactTag.deleteMany({ where: { contactId: existing.id, tag: { name: { notIn: body.tags } } } });
      await setTagsByName(workspaceId, existing.id, body.tags);
    }
    res.json(await prisma.contact.findUnique({ where: { id: existing.id }, include }));
  }),
);

contactsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const r = await prisma.contact.deleteMany({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!r.count) throw notFound("Contacto");
    res.status(204).end();
  }),
);

contactsRouter.post(
  "/:id/verify",
  ah(async (req, res) => {
    const { channels } = z.object({ channels: z.array(channelEnum).optional() }).parse(req.body ?? {});
    res.json(await verifyContactChannels(req.auth.workspaceId, req.params.id, channels));
  }),
);
