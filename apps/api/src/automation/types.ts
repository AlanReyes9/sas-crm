export interface WorkflowNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface RunLog {
  at: string;
  nodeId: string;
  type: string;
  ok: boolean;
  message: string;
}

export interface RunContext {
  workspaceId: string;
  trigger: { type: string; payload?: unknown };
  contact?: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  conversation?: { id: string; channel: string } | null;
  message?: { id: string; body: string; channel: string; subject?: string | null } | null;
  vars: Record<string, unknown>;
}

export interface NodeResult {
  /** Handle de salida a seguir (p. ej. "true"/"false"). undefined = salida por defecto. */
  handle?: string;
  /** Pausar la ejecución hasta esta fecha. */
  waitUntil?: Date;
  /** Terminar el flujo. */
  stop?: boolean;
  log: string;
}

export const TRIGGER_TYPES = ["message_received", "contact_created", "tag_added", "webhook", "manual", "call_completed"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];
