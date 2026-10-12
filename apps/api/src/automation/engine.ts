import type { Contact, Workflow, WorkflowRun } from "@prisma/client";
import { prisma } from "../db.js";
import { emitToWorkspace } from "../lib/realtime.js";
import { contactContext } from "../services/messaging.js";
import { nodeHandlers } from "./nodes.js";
import type { RunContext, RunLog, WorkflowGraph, WorkflowNode } from "./types.js";

const MAX_STEPS = 200;

export function triggerNode(graph: WorkflowGraph): WorkflowNode | undefined {
  return graph.nodes.find((n) => n.type === "trigger");
}

/** Siguiente nodo según el handle de salida. Si no hay arista con ese handle, usa la de por defecto. */
export function nextNodeId(graph: WorkflowGraph, nodeId: string, handle?: string): string | undefined {
  const out = graph.edges.filter((e) => e.source === nodeId);
  if (handle) return out.find((e) => e.sourceHandle === handle)?.target;
  return (out.find((e) => !e.sourceHandle || e.sourceHandle === "out") ?? out[0])?.target;
}

/** Valida la estructura de un grafo antes de guardarlo/activarlo. */
export function validateGraph(graph: WorkflowGraph): string[] {
  const errors: string[] = [];
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) errors.push("El flujo debe tener exactamente un disparador");
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const n of graph.nodes) {
    if (!nodeHandlers[n.type]) errors.push(`Tipo de nodo desconocido: ${n.type}`);
  }
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push(`Conexión rota: ${e.id}`);
  }
  return errors;
}

export function buildContext(
  workspaceId: string,
  trigger: RunContext["trigger"],
  contact: Contact | null,
  extra: Partial<RunContext> = {},
): RunContext {
  return {
    workspaceId,
    trigger,
    contact: contact ? (contactContext(contact).contact as Record<string, unknown>) : null,
    conversation: extra.conversation ?? null,
    message: extra.message ?? null,
    vars: extra.vars ?? {},
  };
}

export async function startRun(workflow: Workflow, ctx: RunContext): Promise<WorkflowRun> {
  const graph = workflow.graph as unknown as WorkflowGraph;
  const trigger = triggerNode(graph);
  const run = await prisma.workflowRun.create({
    data: {
      workspaceId: workflow.workspaceId,
      workflowId: workflow.id,
      context: ctx as object,
      cursor: trigger ? nextNodeId(graph, trigger.id) ?? null : null,
    },
  });
  return executeRun(run, workflow);
}

/** Ejecuta un run desde su cursor hasta que termina, falla o queda en espera. */
export async function executeRun(run: WorkflowRun, workflow?: Workflow): Promise<WorkflowRun> {
  workflow ??= await prisma.workflow.findUniqueOrThrow({ where: { id: run.workflowId } });
  const graph = workflow.graph as unknown as WorkflowGraph;
  const ctx = run.context as unknown as RunContext;
  const logs = [...((run.logs as unknown as RunLog[]) ?? [])];
  let cursor = run.cursor ?? undefined;

  // Al reanudar tras una espera, refrescamos el contacto (pudo cambiar).
  if (run.status === "WAITING" && ctx.contact?.id) {
    const fresh = await prisma.contact.findUnique({ where: { id: ctx.contact.id } });
    if (fresh) ctx.contact = contactContext(fresh).contact as Record<string, unknown>;
  }

  const save = (data: Partial<WorkflowRun>) =>
    prisma.workflowRun.update({
      where: { id: run.id },
      data: { ...data, context: ctx as object, logs: logs as object } as never,
    });

  for (let step = 0; cursor && step < MAX_STEPS; step++) {
    const node = graph.nodes.find((n) => n.id === cursor);
    if (!node) break;
    const handler = nodeHandlers[node.type];
    try {
      const result = await handler(node, ctx);
      logs.push({ at: new Date().toISOString(), nodeId: node.id, type: node.type, ok: true, message: result.log });
      if (result.stop) {
        cursor = undefined;
        break;
      }
      const next = nextNodeId(graph, node.id, result.handle);
      if (result.waitUntil) {
        const updated = await save({ status: "WAITING", resumeAt: result.waitUntil, cursor: next ?? null });
        emitToWorkspace(run.workspaceId, "workflow:run", { id: run.id, workflowId: workflow.id, status: "WAITING" });
        return updated;
      }
      cursor = next;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logs.push({ at: new Date().toISOString(), nodeId: node.id, type: node.type, ok: false, message });
      // Si el nodo tiene salida "error" conectada, seguimos por ahí en lugar de fallar.
      const onError = graph.edges.find((ed) => ed.source === node.id && ed.sourceHandle === "error");
      if (onError) {
        cursor = onError.target;
        continue;
      }
      const failed = await save({ status: "FAILED", error: message, finishedAt: new Date(), cursor: node.id });
      emitToWorkspace(run.workspaceId, "workflow:run", { id: run.id, workflowId: workflow.id, status: "FAILED" });
      return failed;
    }
  }

  const done = await save({ status: "COMPLETED", finishedAt: new Date(), cursor: null, resumeAt: null });
  emitToWorkspace(run.workspaceId, "workflow:run", { id: run.id, workflowId: workflow.id, status: "COMPLETED" });
  return done;
}

/** Reanuda los runs cuya espera ha vencido. Llamado por el scheduler. */
export async function resumeDueRuns() {
  const due = await prisma.workflowRun.findMany({
    where: { status: "WAITING", resumeAt: { lte: new Date() } },
    take: 50,
  });
  for (const run of due) {
    // Reclamamos el run de forma atómica para evitar dobles ejecuciones.
    const claimed = await prisma.workflowRun.updateMany({
      where: { id: run.id, status: "WAITING" },
      data: { status: "RUNNING" },
    });
    if (!claimed.count) continue;
    await executeRun({ ...run, status: "WAITING" }).catch((e) => console.error("[workflow] resume", e));
  }
}
