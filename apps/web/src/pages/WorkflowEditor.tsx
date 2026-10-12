import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import {
  ArrowLeft,
  Bot,
  Clock,
  Copy,
  Flag,
  GitBranch,
  Globe,
  History,
  Play,
  Plug,
  Save,
  Send,
  Tag,
  Tags,
  Trash2,
  UserCheck,
  UserCog,
  Variable,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { useSocketEvent } from "../lib/socket";
import { dateTime, fullName } from "../lib/format";
import type { Contact, Template, Workflow, WorkflowRun } from "../lib/types";
import { Badge, Button, Field, Modal, Spinner, Toggle } from "../components/ui";

export const TRIGGER_LABEL: Record<string, string> = {
  message_received: "Mensaje recibido",
  contact_created: "Contacto creado",
  tag_added: "Etiqueta añadida",
  call_completed: "Llamada finalizada",
  webhook: "Webhook entrante",
  manual: "Manual",
};

interface NodeMeta {
  label: string;
  icon: LucideIcon;
  color: string;
  group: string;
  outputs?: { id: string; label: string }[];
  defaults: Record<string, unknown>;
}

const NODE_TYPES: Record<string, NodeMeta> = {
  trigger: { label: "Disparador", icon: Zap, color: "bg-amber-500", group: "", defaults: { triggerType: "message_received" } },
  send_message: { label: "Enviar mensaje", icon: Send, color: "bg-emerald-500", group: "Mensajería", defaults: { channel: "same", body: "" } },
  condition: {
    label: "Condición",
    icon: GitBranch,
    color: "bg-sky-500",
    group: "Lógica",
    outputs: [
      { id: "true", label: "Sí" },
      { id: "false", label: "No" },
    ],
    defaults: { match: "all", conditions: [{ left: "{{message.body}}", op: "contains", right: "" }] },
  },
  wait: { label: "Esperar", icon: Clock, color: "bg-slate-500", group: "Lógica", defaults: { amount: 1, unit: "hours" } },
  set_variable: { label: "Variable", icon: Variable, color: "bg-slate-500", group: "Lógica", defaults: { name: "", value: "" } },
  ai_agent: {
    label: "Agente IA",
    icon: Bot,
    color: "bg-fuchsia-500",
    group: "IA",
    outputs: [
      { id: "out", label: "" },
      { id: "error", label: "Error" },
    ],
    defaults: { system: "", prompt: "{{message.body}}", saveAs: "ai", reply: true, includeHistory: true },
  },
  webhook: {
    label: "Petición HTTP",
    icon: Globe,
    color: "bg-indigo-500",
    group: "Integraciones",
    outputs: [
      { id: "out", label: "" },
      { id: "error", label: "Error" },
    ],
    defaults: { method: "POST", url: "", headers: "", body: "", saveAs: "" },
  },
  integration: {
    label: "Servicio externo",
    icon: Plug,
    color: "bg-indigo-500",
    group: "Integraciones",
    outputs: [
      { id: "out", label: "" },
      { id: "error", label: "Error" },
    ],
    defaults: { service: "slack", url: "", message: "" },
  },
  add_tag: { label: "Añadir etiqueta", icon: Tag, color: "bg-violet-500", group: "Contacto", defaults: { tagName: "" } },
  remove_tag: { label: "Quitar etiqueta", icon: Tags, color: "bg-violet-500", group: "Contacto", defaults: { tagName: "" } },
  update_contact: { label: "Actualizar contacto", icon: UserCog, color: "bg-violet-500", group: "Contacto", defaults: { field: "company", value: "" } },
  assign: { label: "Asignar agente", icon: UserCheck, color: "bg-orange-500", group: "Conversación", defaults: { mode: "round_robin" } },
  close_conversation: { label: "Cerrar conversación", icon: XCircle, color: "bg-orange-500", group: "Conversación", defaults: {} },
  end: { label: "Fin", icon: Flag, color: "bg-slate-700", group: "Lógica", defaults: {} },
};

/** Resumen corto de la configuración de un nodo para mostrarlo en el lienzo. */
function summary(type: string, d: Record<string, any>): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (type) {
    case "trigger":
      return [TRIGGER_LABEL[d.triggerType], d.channel && d.channel !== "ANY" ? d.channel : "", d.keywords ? `“${d.keywords}”` : "", d.tagName ?? ""]
        .filter(Boolean)
        .join(" · ");
    case "send_message":
      return `${d.channel === "same" ? "Mismo canal" : d.channel}: ${d.templateId ? "plantilla" : (d.body ?? "").slice(0, 40)}`;
    case "condition":
      return (d.conditions ?? []).map((c: { left: string; op: string; right?: string }) => `${c.left} ${c.op} ${c.right ?? ""}`).join(d.match === "any" ? " O " : " Y ");
    case "wait":
      return `${d.amount} ${({ seconds: "seg", minutes: "min", hours: "horas", days: "días" } as Record<string, string>)[d.unit] ?? d.unit}`;
    case "ai_agent":
      return `→ vars.${d.saveAs || "ai"}${d.reply ? " · responde" : ""}`;
    case "webhook":
      return `${d.method} ${d.url}`;
    case "integration":
      return d.service;
    case "add_tag":
    case "remove_tag":
      return d.tagName;
    case "update_contact":
      return `${d.field} = ${d.value}`;
    case "set_variable":
      return `vars.${d.name}`;
    case "assign":
      return d.mode === "round_robin" ? "Reparto equitativo" : "Agente fijo";
    default:
      return "";
  }
}

const StepNode = memo(function StepNode({ type, data, selected }: NodeProps) {
  const meta = NODE_TYPES[type] ?? NODE_TYPES.end;
  const Icon = meta.icon;
  const outputs = meta.outputs ?? (type === "end" ? [] : [{ id: "out", label: "" }]);
  const status = (data as { __status?: "ok" | "error" }).__status;
  return (
    <div
      className={clsx(
        "w-60 rounded-xl border bg-white shadow-sm transition",
        selected ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200",
        status === "error" && "border-rose-400",
      )}
    >
      {type !== "trigger" && <Handle type="target" position={Position.Top} className="!bg-slate-400" />}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={clsx("rounded-md p-1 text-white", meta.color)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-semibold text-slate-800">{meta.label}</span>
        {status && <span className={clsx("ml-auto h-2 w-2 rounded-full", status === "ok" ? "bg-emerald-500" : "bg-rose-500")} />}
      </div>
      <div className="truncate border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">{summary(type, data as Record<string, unknown>) || "Sin configurar"}</div>
      {outputs.map((o, i) => (
        <Handle
          key={o.id}
          id={o.id}
          type="source"
          position={Position.Bottom}
          style={{ left: `${((i + 1) / (outputs.length + 1)) * 100}%` }}
          className={clsx(o.id === "true" ? "!bg-emerald-500" : o.id === "false" || o.id === "error" ? "!bg-rose-500" : "!bg-slate-400")}
        >
          {o.label && <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-[9px] font-medium text-slate-500">{o.label}</span>}
        </Handle>
      ))}
    </div>
  );
});

const nodeTypes = Object.fromEntries(Object.keys(NODE_TYPES).map((k) => [k, StepNode]));

export function WorkflowEditorPage() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

function Editor() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: wf, isLoading } = useQuery({ queryKey: ["workflow", id], queryFn: () => api.get<Workflow>(`/workflows/${id}`) });
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!wf) return;
    setName(wf.name);
    setNodes(wf.graph.nodes.map((n) => ({ ...n, position: n.position ?? { x: 0, y: 0 } })));
    setEdges(wf.graph.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? undefined, animated: false })));
    setDirty(false);
  }, [wf, setNodes, setEdges]);

  const graph = useCallback(
    () => ({
      nodes: nodes.map(({ id, type, position, data }) => ({
        id,
        type: type!,
        position,
        data: Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("__"))),
      })),
      edges: edges.map(({ id, source, target, sourceHandle }) => ({ id, source, target, sourceHandle: sourceHandle ?? null })),
    }),
    [nodes, edges],
  );

  const save = useMutation({
    mutationFn: (active?: boolean) => api.put<Workflow>(`/workflows/${id}`, { name, description: wf?.description, graph: graph(), active: active ?? wf?.active }),
    onSuccess: (w) => {
      qc.setQueryData(["workflow", id], w);
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      setDirty(false);
      setMessage({ ok: true, text: "Guardado" });
    },
    onError: (e) => setMessage({ ok: false, text: (e as Error).message }),
  });
  const del = useMutation({ mutationFn: () => api.del(`/workflows/${id}`), onSuccess: () => nav("/automations") });

  const onConnect = useCallback(
    (c: Connection) => {
      // Un handle de salida solo puede tener una conexión.
      setEdges((eds) => addEdge({ ...c, id: `e_${Date.now()}` }, eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)))));
      setDirty(true);
    },
    [setEdges],
  );

  function addNode(type: string) {
    const nid = `${type}_${Math.random().toString(36).slice(2, 7)}`;
    const last = nodes.find((n) => n.id === selectedId) ?? nodes[nodes.length - 1];
    const position = last ? { x: last.position.x, y: last.position.y + 140 } : { x: 250, y: 40 };
    setNodes((ns) => [...ns, { id: nid, type, position, data: structuredClone(NODE_TYPES[type].defaults) }]);
    if (last && !NODE_TYPES[last.type!]?.outputs && last.type !== "end" && !edges.some((e) => e.source === last.id)) {
      setEdges((es) => [...es, { id: `e_${nid}`, source: last.id, target: nid }]);
    }
    setSelectedId(nid);
    setDirty(true);
  }

  function updateData(patch: Record<string, unknown>) {
    setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  }

  function showRun(run: WorkflowRun) {
    const status = new Map(run.logs.map((l) => [l.nodeId, l.ok ? "ok" : "error"]));
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, __status: status.get(n.id) } })));
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const groups = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const [k, m] of Object.entries(NODE_TYPES)) if (m.group) (g[m.group] ??= []).push(k);
    return g;
  }, []);

  if (isLoading || !wf) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => nav("/automations")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <input className="w-72 rounded-md px-2 py-1 font-medium text-slate-900 outline-none hover:bg-slate-50 focus:bg-slate-50" value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} />
        {dirty && <span className="text-xs text-amber-600">Cambios sin guardar</span>}
        {message && <span className={clsx("text-xs", message.ok ? "text-emerald-600" : "text-rose-600")}>{message.text}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Toggle checked={wf.active} onChange={(v) => save.mutate(v)} label={wf.active ? "Activo" : "Inactivo"} />
          <Button size="sm" variant="secondary" onClick={() => setRunsOpen(true)}>
            <History className="h-3.5 w-3.5" /> Ejecuciones
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setTestOpen(true)} disabled={dirty}>
            <Play className="h-3.5 w-3.5" /> Probar
          </Button>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>
            <Save className="h-3.5 w-3.5" /> Guardar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("¿Eliminar esta automatización?") && del.mutate()}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3">
          {Object.entries(groups).map(([g, types]) => (
            <div key={g} className="mb-4">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g}</p>
              {types.map((t) => {
                const m = NODE_TYPES[t];
                return (
                  <button key={t} onClick={() => addNode(t)} className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100">
                    <span className={clsx("rounded p-1 text-white", m.color)}>
                      <m.icon className="h-3 w-3" />
                    </span>
                    {m.label}
                  </button>
                );
              })}
            </div>
          ))}
          <p className="text-[11px] leading-snug text-slate-400">Haz clic para añadir un paso. Conecta los puntos de salida con la entrada del siguiente paso.</p>
        </aside>
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(c) => {
              onNodesChange(c);
              if (c.some((x) => x.type === "position" || x.type === "remove")) setDirty(true);
            }}
            onEdgesChange={(c) => {
              onEdgesChange(c);
              if (c.some((x) => x.type === "remove")) setDirty(true);
            }}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            defaultEdgeOptions={{ style: { strokeWidth: 2 } }}
          >
            <Background gap={20} />
            <Controls />
            <MiniMap pannable zoomable className="!bg-slate-50" />
          </ReactFlow>
        </div>
        {selected && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-medium">{NODE_TYPES[selected.type!]?.label}</p>
              {selected.type !== "trigger" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
                    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
                    setSelectedId(null);
                    setDirty(true);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <NodeConfig type={selected.type!} data={selected.data as Record<string, any>} onChange={updateData} workflow={wf} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
            <VariablesHelp />
          </aside>
        )}
      </div>
      {runsOpen && <RunsModal workflowId={wf.id} onClose={() => setRunsOpen(false)} onShow={(r) => (showRun(r), setRunsOpen(false))} />}
      {testOpen && <TestModal workflowId={wf.id} onClose={() => setTestOpen(false)} onDone={(r) => (showRun(r), setTestOpen(false), setRunsOpen(true))} />}
    </div>
  );
}

function VariablesHelp() {
  return (
    <div className="mt-6 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
      <p className="mb-1 font-semibold text-slate-600">Variables disponibles</p>
      <code>{"{{contact.firstName}}"}</code>, <code>{"{{contact.phone}}"}</code>, <code>{"{{contact.<campo>}}"}</code>, <code>{"{{message.body}}"}</code>,{" "}
      <code>{"{{message.channel}}"}</code>, <code>{"{{vars.<nombre>}}"}</code> (resultados de IA, webhooks y del payload entrante), <code>{"{{workspace.name}}"}</code>.
      Valor por defecto: <code>{'{{contact.firstName | "cliente"}}'}</code>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function NodeConfig({ type, data, onChange, workflow }: { type: string; data: Record<string, any>; onChange: (p: Record<string, unknown>) => void; workflow: Workflow }) {
  const templates = useQuery({ queryKey: ["templates", ""], queryFn: () => api.get<Template[]>("/templates"), enabled: type === "send_message" });
  const team = useQuery({ queryKey: ["team"], queryFn: () => api.get<{ userId: string; name: string }[]>("/team"), enabled: type === "assign" });
  const input = (key: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="input" value={data[key] ?? ""} onChange={(e) => onChange({ [key]: props.type === "number" ? Number(e.target.value) : e.target.value })} {...props} />
  );
  const area = (key: string, rows = 4, placeholder?: string) => (
    <textarea className="input font-mono text-xs" rows={rows} value={data[key] ?? ""} placeholder={placeholder} onChange={(e) => onChange({ [key]: e.target.value })} />
  );

  switch (type) {
    case "trigger":
      return (
        <div className="space-y-3">
          <Field label="Cuando…">
            <select className="input" value={data.triggerType} onChange={(e) => onChange({ triggerType: e.target.value })}>
              {Object.entries(TRIGGER_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {data.triggerType === "message_received" && (
            <>
              <Field label="Canal">
                <select className="input" value={data.channel ?? "ANY"} onChange={(e) => onChange({ channel: e.target.value })}>
                  <option value="ANY">Cualquiera</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="SMS">SMS</option>
                  <option value="EMAIL">Correo</option>
                </select>
              </Field>
              <Field label="Palabras clave (opcional)" help="Separadas por coma. Vacío = cualquier mensaje.">
                {input("keywords", { placeholder: "precio, info, ayuda" })}
              </Field>
            </>
          )}
          {data.triggerType === "tag_added" && <Field label="Etiqueta (vacío = cualquiera)">{input("tagName")}</Field>}
          {data.triggerType === "call_completed" && (
            <Field label="Estado de la llamada">
              <select className="input" value={data.callStatus ?? "ANY"} onChange={(e) => onChange({ callStatus: e.target.value })}>
                <option value="ANY">Cualquiera</option>
                <option value="COMPLETED">Contestada</option>
                <option value="NO_ANSWER">No contestada</option>
                <option value="BUSY">Ocupado</option>
              </select>
            </Field>
          )}
          {data.triggerType === "webhook" && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs">
              <p className="mb-1 font-medium">Envía un POST a:</p>
              <div className="flex items-center gap-1">
                <code className="flex-1 break-all">{workflow.webhookUrl}</code>
                <button onClick={() => void navigator.clipboard.writeText(workflow.webhookUrl)}>
                  <Copy className="h-3.5 w-3.5 text-slate-400" />
                </button>
              </div>
              <p className="mt-2 text-slate-500">
                Si el JSON incluye <code>phone</code> o <code>email</code> (y <code>name</code>), se crea o vincula el contacto. El cuerpo queda en <code>{"{{vars.payload}}"}</code>.
                Guarda y activa el flujo para usarlo.
              </p>
            </div>
          )}
        </div>
      );
    case "send_message":
      return (
        <div className="space-y-3">
          <Field label="Canal">
            <select className="input" value={data.channel} onChange={(e) => onChange({ channel: e.target.value })}>
              <option value="same">El mismo de la conversación</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">Correo</option>
            </select>
          </Field>
          <Field label="Plantilla (opcional)">
            <select className="input" value={data.templateId ?? ""} onChange={(e) => onChange({ templateId: e.target.value || undefined })}>
              <option value="">— Mensaje libre —</option>
              {templates.data
                ?.filter((t) => data.channel === "same" || t.channel === data.channel)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.channel})
                  </option>
                ))}
            </select>
          </Field>
          {!data.templateId && (
            <>
              {data.channel === "EMAIL" && <Field label="Asunto">{input("subject")}</Field>}
              <Field label="Mensaje">{area("body", 5, "Hola {{contact.firstName}}…")}</Field>
            </>
          )}
        </div>
      );
    case "condition": {
      const conds = (data.conditions ?? []) as { left: string; op: string; right?: string }[];
      const set = (i: number, p: Partial<(typeof conds)[number]>) => onChange({ conditions: conds.map((c, j) => (j === i ? { ...c, ...p } : c)) });
      return (
        <div className="space-y-3">
          <Field label="Se cumple si…">
            <select className="input" value={data.match} onChange={(e) => onChange({ match: e.target.value })}>
              <option value="all">Todas las condiciones</option>
              <option value="any">Alguna condición</option>
            </select>
          </Field>
          {conds.map((c, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
              <input className="input text-xs" value={c.left} onChange={(e) => set(i, { left: e.target.value })} placeholder="{{message.body}}" />
              <select className="input text-xs" value={c.op} onChange={(e) => set(i, { op: e.target.value })}>
                <option value="contains">contiene (lista por comas)</option>
                <option value="not_contains">no contiene</option>
                <option value="equals">es igual a</option>
                <option value="not_equals">es distinto de</option>
                <option value="starts_with">empieza por</option>
                <option value="is_empty">está vacío</option>
                <option value="is_not_empty">no está vacío</option>
                <option value="gt">mayor que</option>
                <option value="lt">menor que</option>
                <option value="matches">regex</option>
              </select>
              {!["is_empty", "is_not_empty"].includes(c.op) && (
                <input className="input text-xs" value={c.right ?? ""} onChange={(e) => set(i, { right: e.target.value })} placeholder="valor" />
              )}
              <button className="text-xs text-rose-600" onClick={() => onChange({ conditions: conds.filter((_, j) => j !== i) })}>
                Quitar
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => onChange({ conditions: [...conds, { left: "{{message.body}}", op: "contains", right: "" }] })}>
            + Condición
          </Button>
          <p className="text-xs text-slate-500">Conecta la salida verde (Sí) y la roja (No).</p>
        </div>
      );
    }
    case "wait":
      return (
        <div className="flex gap-2">
          {input("amount", { type: "number", min: 1 })}
          <select className="input" value={data.unit} onChange={(e) => onChange({ unit: e.target.value })}>
            <option value="seconds">segundos</option>
            <option value="minutes">minutos</option>
            <option value="hours">horas</option>
            <option value="days">días</option>
          </select>
        </div>
      );
    case "ai_agent":
      return (
        <div className="space-y-3">
          <Field label="Instrucciones del agente (system)">{area("system", 5, "Eres el asistente de {{workspace.name}}…")}</Field>
          <Field label="Entrada (prompt)">{area("prompt", 3)}</Field>
          <Field label="Guardar respuesta en vars.">{input("saveAs")}</Field>
          <Field label="Modelo (opcional)" help="Por defecto, el configurado en el servidor">
            {input("model", { placeholder: "claude-opus-5-5" })}
          </Field>
          <Field label="Esfuerzo de razonamiento">
            <select className="input" value={data.effort ?? ""} onChange={(e) => onChange({ effort: e.target.value || undefined })}>
              <option value="">Predeterminado</option>
              <option value="low">Bajo (más rápido)</option>
              <option value="medium">Medio</option>
              <option value="high">Alto</option>
            </select>
          </Field>
          <Toggle checked={!!data.reply} onChange={(v) => onChange({ reply: v })} label="Responder al contacto con el resultado" />
          <Toggle checked={data.includeHistory !== false} onChange={(v) => onChange({ includeHistory: v })} label="Incluir historial de la conversación" />
        </div>
      );
    case "webhook":
      return (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select className="input w-28" value={data.method} onChange={(e) => onChange({ method: e.target.value })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            {input("url", { placeholder: "https://api.ejemplo.com/leads" })}
          </div>
          <Field label="Cabeceras (JSON)">{area("headers", 3, '{"Authorization": "Bearer …"}')}</Field>
          <Field label="Cuerpo" help="Vacío = se envía contacto, mensaje y variables">{area("body", 5, '{"telefono": "{{contact.phone}}"}')}</Field>
          <Field label="Guardar respuesta en vars.">{input("saveAs")}</Field>
          <Toggle checked={!!data.continueOnError} onChange={(v) => onChange({ continueOnError: v })} label="Continuar aunque falle" />
        </div>
      );
    case "integration":
      return (
        <div className="space-y-3">
          <Field label="Servicio">
            <select className="input" value={data.service} onChange={(e) => onChange({ service: e.target.value })}>
              <option value="slack">Slack (Incoming Webhook)</option>
              <option value="discord">Discord (Webhook)</option>
              <option value="teams">Microsoft Teams (Webhook)</option>
              <option value="google_sheets">Google Sheets (Apps Script)</option>
              <option value="zapier">Zapier</option>
              <option value="make">Make</option>
              <option value="n8n">n8n</option>
              <option value="custom">Otro (JSON genérico)</option>
            </select>
          </Field>
          <Field label="URL del webhook">{input("url")}</Field>
          <Field label="Mensaje">{area("message", 3, "Nuevo lead: {{contact.fullName}}")}</Field>
        </div>
      );
    case "add_tag":
    case "remove_tag":
      return <Field label="Etiqueta">{input("tagName")}</Field>;
    case "update_contact":
      return (
        <div className="space-y-3">
          <Field label="Campo" help="firstName, lastName, email, phone, company, notes o custom.<clave>">
            {input("field")}
          </Field>
          <Field label="Valor">{input("value", { placeholder: "{{vars.ai}}" })}</Field>
        </div>
      );
    case "set_variable":
      return (
        <div className="space-y-3">
          <Field label="Nombre">{input("name")}</Field>
          <Field label="Valor">{input("value")}</Field>
        </div>
      );
    case "assign":
      return (
        <div className="space-y-3">
          <Field label="Modo">
            <select className="input" value={data.mode} onChange={(e) => onChange({ mode: e.target.value })}>
              <option value="round_robin">Reparto equitativo (menos conversaciones abiertas)</option>
              <option value="fixed">Agente fijo</option>
            </select>
          </Field>
          {data.mode === "fixed" && (
            <select className="input" value={data.userId ?? ""} onChange={(e) => onChange({ userId: e.target.value })}>
              <option value="">Elige…</option>
              {team.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    default:
      return <p className="text-sm text-slate-500">Este paso no tiene configuración.</p>;
  }
}

function RunsModal({ workflowId, onClose, onShow }: { workflowId: string; onClose: () => void; onShow: (r: WorkflowRun) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["runs", workflowId], queryFn: () => api.get<WorkflowRun[]>(`/workflows/${workflowId}/runs`) });
  useSocketEvent(
    "workflow:run",
    useCallback(() => void qc.invalidateQueries({ queryKey: ["runs", workflowId] }), [qc, workflowId]),
  );
  const color = { COMPLETED: "green", FAILED: "red", WAITING: "yellow", RUNNING: "blue" } as const;
  return (
    <Modal open wide onClose={onClose} title="Ejecuciones recientes">
      {!data?.length && <p className="text-sm text-slate-500">Todavía no hay ejecuciones.</p>}
      <div className="space-y-3">
        {data?.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <Badge color={color[r.status]}>{r.status}</Badge>
              <span className="text-xs text-slate-500">{dateTime(r.startedAt)}</span>
              {r.resumeAt && r.status === "WAITING" && <span className="text-xs text-slate-500">· reanuda {dateTime(r.resumeAt)}</span>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onShow(r)}>
                Ver en el lienzo
              </Button>
            </div>
            <ol className="mt-2 space-y-0.5 text-xs">
              {r.logs.map((l, i) => (
                <li key={i} className={l.ok ? "text-slate-600" : "text-rose-600"}>
                  {l.ok ? "✓" : "✗"} <b>{NODE_TYPES[l.type]?.label ?? l.type}</b> — {l.message}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function TestModal({ workflowId, onClose, onDone }: { workflowId: string; onClose: () => void; onDone: (r: WorkflowRun) => void }) {
  const [q, setQ] = useState("");
  const [contactId, setContactId] = useState("");
  const [message, setMessage] = useState("Hola, ¿cuál es el precio?");
  const contacts = useQuery({ queryKey: ["contacts-test", q], queryFn: () => api.get<{ items: Contact[] }>(`/contacts?pageSize=6&q=${encodeURIComponent(q)}`) });
  const run = useMutation({ mutationFn: () => api.post<WorkflowRun>(`/workflows/${workflowId}/run`, { contactId: contactId || undefined, message }), onSuccess: onDone });
  return (
    <Modal
      open
      onClose={onClose}
      title="Probar automatización"
      footer={
        <Button loading={run.isPending} onClick={() => run.mutate()}>
          <Play className="h-4 w-4" /> Ejecutar
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-500">Ejecuta el flujo ahora con un contacto y un mensaje de ejemplo. Las acciones son reales (se enviarán mensajes por el proveedor configurado).</p>
      <Field label="Contacto">
        <input className="input mb-2" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <div className="mb-3 max-h-40 space-y-1 overflow-y-auto">
        {contacts.data?.items.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={contactId === c.id} onChange={() => setContactId(c.id)} /> {fullName(c)}{" "}
            <span className="text-xs text-slate-400">{c.phone ?? c.email}</span>
          </label>
        ))}
      </div>
      <Field label="Mensaje de prueba ({{message.body}})">
        <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      {run.error && <p className="mt-2 text-sm text-rose-600">{(run.error as Error).message}</p>}
    </Modal>
  );
}
