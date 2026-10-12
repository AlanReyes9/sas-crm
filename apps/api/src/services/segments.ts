import { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Segmentos dinámicos. Las reglas se traducen a un filtro de Prisma, de modo que
 * siempre reflejan el estado actual de los contactos.
 */
export const conditionSchema = z.object({
  field: z.string(), // firstName | lastName | email | phone | company | createdAt | tag | optOut | hasChannel | verified | custom.<clave>
  op: z.enum([
    "equals",
    "not_equals",
    "contains",
    "starts_with",
    "is_empty",
    "is_not_empty",
    "has",
    "not_has",
    "before",
    "after",
    "in_last_days",
  ]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const rulesSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(conditionSchema).default([]),
});

export type SegmentRules = z.infer<typeof rulesSchema>;
type Cond = z.infer<typeof conditionSchema>;

const TEXT_FIELDS = ["firstName", "lastName", "email", "phone", "whatsapp", "company", "notes"] as const;

function textFilter(field: string, c: Cond): Prisma.ContactWhereInput {
  const v = String(c.value ?? "");
  switch (c.op) {
    case "equals":
      return { [field]: { equals: v, mode: "insensitive" } };
    case "not_equals":
      return { NOT: { [field]: { equals: v, mode: "insensitive" } } };
    case "contains":
      return { [field]: { contains: v, mode: "insensitive" } };
    case "starts_with":
      return { [field]: { startsWith: v, mode: "insensitive" } };
    case "is_empty":
      return { OR: [{ [field]: null }, { [field]: "" }] };
    case "is_not_empty":
      return { AND: [{ NOT: { [field]: null } }, { NOT: { [field]: "" } }] };
    default:
      throw new Error(`Operador ${c.op} no válido para ${field}`);
  }
}

function conditionToWhere(c: Cond): Prisma.ContactWhereInput {
  if ((TEXT_FIELDS as readonly string[]).includes(c.field)) return textFilter(c.field, c);

  if (c.field === "tag") {
    const has = { tags: { some: { tag: { name: { equals: String(c.value), mode: "insensitive" as const } } } } };
    return c.op === "not_has" || c.op === "not_equals" ? { NOT: has } : has;
  }
  if (c.field === "optOut") return { optOut: c.value === true || c.value === "true" };
  if (c.field === "hasChannel") {
    const ch = String(c.value).toUpperCase();
    const where: Prisma.ContactWhereInput =
      ch === "EMAIL" ? { email: { not: null } } : ch === "WHATSAPP" ? { OR: [{ whatsapp: { not: null } }, { phone: { not: null } }] } : { phone: { not: null } };
    return c.op === "not_has" ? { NOT: where } : where;
  }
  if (c.field === "verified") {
    const ch = String(c.value).toUpperCase() as "EMAIL";
    const where: Prisma.ContactWhereInput = { verifications: { some: { channel: ch, status: "VALID" } } };
    return c.op === "not_has" ? { NOT: where } : where;
  }
  if (c.field === "createdAt") {
    if (c.op === "in_last_days") return { createdAt: { gte: new Date(Date.now() - Number(c.value) * 86400000) } };
    const d = new Date(String(c.value));
    if (c.op === "before") return { createdAt: { lt: d } };
    if (c.op === "after") return { createdAt: { gt: d } };
  }
  if (c.field.startsWith("custom.")) {
    const key = c.field.slice(7);
    const path = [key];
    switch (c.op) {
      case "equals":
        return { customFields: { path, equals: c.value as string } };
      case "not_equals":
        return { NOT: { customFields: { path, equals: c.value as string } } };
      case "contains":
        return { customFields: { path, string_contains: String(c.value) } };
      case "is_empty":
        return { OR: [{ customFields: { path, equals: Prisma.AnyNull } }, { customFields: { path, equals: "" } }] };
      case "is_not_empty":
        return { NOT: { OR: [{ customFields: { path, equals: Prisma.AnyNull } }, { customFields: { path, equals: "" } }] } };
    }
  }
  throw new Error(`Condición no soportada: ${c.field} ${c.op}`);
}

export function rulesToWhere(workspaceId: string, raw: unknown): Prisma.ContactWhereInput {
  const rules = rulesSchema.parse(raw);
  const parts = rules.conditions.map(conditionToWhere);
  if (!parts.length) return { workspaceId };
  return { workspaceId, ...(rules.match === "all" ? { AND: parts } : { OR: parts }) };
}
