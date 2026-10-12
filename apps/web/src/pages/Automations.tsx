import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bot, Plus, Workflow as WorkflowIcon, Zap } from "lucide-react";
import { api } from "../lib/api";
import { relTime } from "../lib/format";
import type { Workflow } from "../lib/types";
import { Badge, Button, Empty, PageHeader, Spinner, Toggle } from "../components/ui";
import { TRIGGER_LABEL } from "./WorkflowEditor";

const STARTERS: { name: string; description: string; graph: Workflow["graph"] }[] = [
  {
    name: "Flujo en blanco",
    description: "Empieza desde cero",
    graph: { nodes: [{ id: "trigger", type: "trigger", position: { x: 250, y: 40 }, data: { triggerType: "message_received", channel: "ANY" } }], edges: [] },
  },
  {
    name: "Bienvenida a nuevos contactos",
    description: "Etiqueta y envía un WhatsApp de bienvenida; recuerda a las 24 h",
    graph: {
      nodes: [
        { id: "trigger", type: "trigger", position: { x: 250, y: 40 }, data: { triggerType: "contact_created" } },
        { id: "tag", type: "add_tag", position: { x: 250, y: 170 }, data: { tagName: "nuevo" } },
        { id: "msg", type: "send_message", position: { x: 250, y: 300 }, data: { channel: "WHATSAPP", body: "¡Hola {{contact.firstName}}! Gracias por escribirnos 🙌" } },
        { id: "wait", type: "wait", position: { x: 250, y: 430 }, data: { amount: 1, unit: "days" } },
        { id: "msg2", type: "send_message", position: { x: 250, y: 560 }, data: { channel: "WHATSAPP", body: "¿Te podemos ayudar en algo más, {{contact.firstName}}?" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "tag" },
        { id: "e2", source: "tag", target: "msg" },
        { id: "e3", source: "msg", target: "wait" },
        { id: "e4", source: "wait", target: "msg2" },
      ],
    },
  },
  {
    name: "Agente IA + escalado",
    description: "La IA responde y, si detecta urgencia, avisa al equipo por Slack",
    graph: {
      nodes: [
        { id: "trigger", type: "trigger", position: { x: 250, y: 40 }, data: { triggerType: "message_received", channel: "ANY" } },
        {
          id: "ai",
          type: "ai_agent",
          position: { x: 250, y: 170 },
          data: { system: "Eres el asistente de {{workspace.name}}. Responde breve y amable.", prompt: "{{message.body}}", saveAs: "respuesta", reply: true, includeHistory: true },
        },
        {
          id: "cls",
          type: "ai_agent",
          position: { x: 250, y: 320 },
          data: { system: "Clasifica la urgencia del mensaje. Responde solo URGENTE o NORMAL.", prompt: "{{message.body}}", saveAs: "urgencia", reply: false, includeHistory: false },
        },
        { id: "cond", type: "condition", position: { x: 250, y: 470 }, data: { match: "all", conditions: [{ left: "{{vars.urgencia}}", op: "contains", right: "urgente" }] } },
        { id: "slack", type: "integration", position: { x: 80, y: 620 }, data: { service: "slack", url: "https://hooks.slack.com/services/…", message: "🚨 Urgente de {{contact.fullName}}: {{message.body}}" } },
        { id: "assign", type: "assign", position: { x: 80, y: 760 }, data: { mode: "round_robin" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "ai" },
        { id: "e2", source: "ai", target: "cls" },
        { id: "e3", source: "cls", target: "cond" },
        { id: "e4", source: "cond", target: "slack", sourceHandle: "true" },
        { id: "e5", source: "slack", target: "assign" },
      ],
    },
  },
];

export function AutomationsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["workflows"], queryFn: () => api.get<Workflow[]>("/workflows") });
  const create = useMutation({
    mutationFn: (s: (typeof STARTERS)[number]) => api.post<Workflow>("/workflows", { name: s.name, description: s.description, graph: s.graph }),
    onSuccess: (wf) => nav(`/automations/${wf.id}`),
  });
  const toggle = useMutation({
    mutationFn: (id: string) => api.post(`/workflows/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
    onError: (e) => alert((e as Error).message),
  });

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader title="Automatizaciones" subtitle="Flujos visuales con condiciones, esperas, webhooks, agentes de IA e integraciones" />
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {STARTERS.map((s) => (
          <button key={s.name} onClick={() => create.mutate(s)} className="card flex items-start gap-3 p-4 text-left transition hover:border-brand-300">
            <span className="rounded-lg bg-brand-50 p-2 text-brand-600">{s.name.includes("IA") ? <Bot className="h-5 w-5" /> : s.name.includes("blanco") ? <Plus className="h-5 w-5" /> : <Zap className="h-5 w-5" />}</span>
            <span>
              <span className="block text-sm font-medium text-slate-900">{s.name}</span>
              <span className="block text-xs text-slate-500">{s.description}</span>
            </span>
          </button>
        ))}
      </div>
      {isLoading && <Spinner />}
      <div className="card divide-y divide-slate-100">
        {data?.map((wf) => (
          <div key={wf.id} className="flex items-center gap-4 px-4 py-3">
            <WorkflowIcon className="h-5 w-5 text-slate-400" />
            <button onClick={() => nav(`/automations/${wf.id}`)} className="min-w-0 flex-1 text-left">
              <p className="font-medium text-slate-900">{wf.name}</p>
              <p className="truncate text-xs text-slate-500">{wf.description}</p>
            </button>
            <Badge color="blue">{TRIGGER_LABEL[wf.triggerType] ?? wf.triggerType}</Badge>
            <span className="w-28 text-right text-xs text-slate-400">
              {wf._count?.runs ?? 0} ejecuciones
              <br />
              {relTime(wf.updatedAt)}
            </span>
            <Toggle checked={wf.active} onChange={() => toggle.mutate(wf.id)} />
          </div>
        ))}
        {data?.length === 0 && <Empty icon={<WorkflowIcon className="h-5 w-5" />} title="Sin automatizaciones" text="Elige una plantilla de arriba para empezar." />}
      </div>
    </div>
  );
}
