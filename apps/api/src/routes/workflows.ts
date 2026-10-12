import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { badRequest, notFound } from "../lib/errors.js";
import { config } from "../config.js";
import { buildContext, startRun, validateGraph } from "../automation/engine.js";
import { TRIGGER_TYPES, type WorkflowGraph } from "../automation/types.js";

export const workflowsRouter = Router();

const graphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      data: z.record(z.any()).default({}),
    }),
  ),
  edges: z.array(
    z.object({ id: z.string(), source: z.string(), target: z.string(), sourceHandle: z.string().nullish() }),
  ),
});

const input = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  graph: graphSchema,
  active: z.boolean().optional(),
});

function triggerTypeOf(graph: WorkflowGraph) {
  const t = graph.nodes.find((n) => n.type === "trigger");
  const type = String(t?.data?.triggerType ?? "manual");
  if (!(TRIGGER_TYPES as readonly string[]).includes(type)) throw badRequest(`Disparador desconocido: ${type}`);
  return type;
}

async function owned(workspaceId: string, id: string) {
  const wf = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!wf) throw notFound("Automatización");
  return wf;
}

const withHookUrl = <T extends { webhookKey: string }>(wf: T) => ({
  ...wf,
  webhookUrl: `${config.publicUrl}/hooks/${wf.webhookKey}`,
});

workflowsRouter.get(
  "/",
  ah(async (req, res) => {
    const items = await prisma.workflow.findMany({
      where: { workspaceId: req.auth.workspaceId },
      include: { _count: { select: { runs: true } } },
      orderBy: { updatedAt: "desc" },
    });
    res.json(items.map(withHookUrl));
  }),
);

workflowsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = input.parse(req.body);
    const errors = validateGraph(body.graph);
    if (body.active && errors.length) throw badRequest("El flujo tiene errores", errors);
    const wf = await prisma.workflow.create({
      data: {
        workspaceId: req.auth.workspaceId,
        name: body.name,
        description: body.description,
        graph: body.graph as object,
        triggerType: triggerTypeOf(body.graph),
        active: body.active ?? false,
      },
    });
    res.status(201).json(withHookUrl(wf));
  }),
);

workflowsRouter.get(
  "/:id",
  ah(async (req, res) => {
    res.json(withHookUrl(await owned(req.auth.workspaceId, req.params.id)));
  }),
);

workflowsRouter.put(
  "/:id",
  ah(async (req, res) => {
    const wf = await owned(req.auth.workspaceId, req.params.id);
    const body = input.parse(req.body);
    const errors = validateGraph(body.graph);
    const active = body.active ?? wf.active;
    if (active && errors.length) throw badRequest("El flujo tiene errores", errors);
    const updated = await prisma.workflow.update({
      where: { id: wf.id },
      data: {
        name: body.name,
        description: body.description,
        graph: body.graph as object,
        triggerType: triggerTypeOf(body.graph),
        active,
      },
    });
    res.json(withHookUrl(updated));
  }),
);

workflowsRouter.post(
  "/:id/toggle",
  ah(async (req, res) => {
    const wf = await owned(req.auth.workspaceId, req.params.id);
    if (!wf.active) {
      const errors = validateGraph(wf.graph as unknown as WorkflowGraph);
      if (errors.length) throw badRequest("El flujo tiene errores", errors);
    }
    res.json(withHookUrl(await prisma.workflow.update({ where: { id: wf.id }, data: { active: !wf.active } })));
  }),
);

workflowsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    await owned(req.auth.workspaceId, req.params.id);
    await prisma.workflow.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

/** Ejecución manual (prueba) con un contacto opcional. */
workflowsRouter.post(
  "/:id/run",
  ah(async (req, res) => {
    const wf = await owned(req.auth.workspaceId, req.params.id);
    const { contactId, message, vars } = z
      .object({ contactId: z.string().optional(), message: z.string().optional(), vars: z.record(z.unknown()).default({}) })
      .parse(req.body ?? {});
    const contact = contactId
      ? await prisma.contact.findFirst({ where: { id: contactId, workspaceId: req.auth.workspaceId } })
      : null;
    let conversation = null;
    if (contact) {
      conversation = await prisma.conversation.findFirst({ where: { contactId: contact.id }, orderBy: { lastMessageAt: "desc" } });
    }
    const ctx = buildContext(req.auth.workspaceId, { type: "manual" }, contact, {
      conversation: conversation ? { id: conversation.id, channel: conversation.channel } : null,
      message: message ? { id: "", body: message, channel: conversation?.channel ?? "WHATSAPP" } : null,
      vars,
    });
    res.json(await startRun(wf, ctx));
  }),
);

workflowsRouter.get(
  "/:id/runs",
  ah(async (req, res) => {
    await owned(req.auth.workspaceId, req.params.id);
    res.json(
      await prisma.workflowRun.findMany({ where: { workflowId: req.params.id }, orderBy: { startedAt: "desc" }, take: 50 }),
    );
  }),
);
