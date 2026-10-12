import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Copy, FlaskConical, Plug, Plus, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CHANNEL_LABEL } from "../lib/format";
import type { Channel, ChannelRoute, Connection, ProviderDef } from "../lib/types";
import { Badge, Button, Empty, Field, Modal, PageHeader, Tabs } from "../components/ui";
import { ChannelIcon } from "../components/ChannelIcon";
import { DynamicForm } from "../components/DynamicForm";

type Tab = "providers" | "routing" | "team" | "sandbox";

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("providers");
  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader title="Ajustes" subtitle="Proveedores, enrutamiento de canales y equipo" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "providers", label: "Proveedores" },
          { value: "routing", label: "Enrutamiento" },
          { value: "team", label: "Equipo" },
          { value: "sandbox", label: "Sandbox" },
        ]}
      />
      <div className="mt-6">
        {tab === "providers" && <ProvidersTab />}
        {tab === "routing" && <RoutingTab />}
        {tab === "team" && <TeamTab />}
        {tab === "sandbox" && <SandboxTab />}
      </div>
    </div>
  );
}

function ProvidersTab() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<ProviderDef | null>(null);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail?: string }>>({});
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.get<ProviderDef[]>("/connections/providers") });
  const conns = useQuery({ queryKey: ["connections"], queryFn: () => api.get<Connection[]>("/connections") });
  const inv = () => qc.invalidateQueries({ queryKey: ["connections"] });
  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; detail?: string }>(`/connections/${id}/test`),
    onSuccess: (r, id) => (setTestResult((t) => ({ ...t, [id]: r })), void inv()),
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/connections/${id}`), onSuccess: inv });

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-medium text-slate-900">Conexiones activas</h2>
        <div className="space-y-3">
          {conns.data?.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Plug className="h-5 w-5 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.providerLabel}</p>
                </div>
                <div className="flex gap-1">
                  {c.channels.map((ch) => (
                    <ChannelIcon key={ch} channel={ch} size="sm" />
                  ))}
                </div>
                <Badge color={c.status === "active" ? "green" : c.status === "error" ? "red" : "yellow"}>{c.status}</Badge>
                <Button size="sm" variant="secondary" loading={test.isPending && test.variables === c.id} onClick={() => test.mutate(c.id)}>
                  <FlaskConical className="h-3.5 w-3.5" /> Probar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => confirm(`¿Eliminar la conexión "${c.name}"?`) && del.mutate(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {testResult[c.id] && (
                <p className={clsx("mt-2 text-xs", testResult[c.id].ok ? "text-emerald-700" : "text-rose-600")}>
                  {testResult[c.id].ok ? "✓" : "✗"} {testResult[c.id].detail}
                </p>
              )}
              {c.lastError && !testResult[c.id] && <p className="mt-2 text-xs text-rose-600">{c.lastError}</p>}
              {c.webhooks.length > 0 && (
                <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-600">Configura estas URLs en el panel del proveedor:</p>
                  {c.webhooks.map((w) => (
                    <div key={w.path} className="flex items-center gap-2 text-xs">
                      <span className="w-72 shrink-0 text-slate-500">{w.label}</span>
                      <code className="flex-1 truncate rounded bg-white px-2 py-1 text-slate-700">{w.url}</code>
                      <button onClick={() => void navigator.clipboard.writeText(w.url)} title="Copiar">
                        <Copy className="h-3.5 w-3.5 text-slate-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {conns.data?.length === 0 && <Empty title="Sin conexiones" text="Añade un proveedor del catálogo." />}
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-medium text-slate-900">Catálogo de proveedores</h2>
        <p className="mb-3 text-sm text-slate-500">Conecta varios y decide en “Enrutamiento” cuál entrega cada canal.</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {providers.data?.map((p) => (
            <div key={p.key} className="card flex flex-col p-4">
              <p className="font-medium text-slate-900">{p.label}</p>
              <p className="mt-1 flex-1 text-sm text-slate-500">{p.description}</p>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-1">
                  {p.channels.map((ch) => (
                    <ChannelIcon key={ch} channel={ch} size="sm" />
                  ))}
                </div>
                <Button size="sm" variant="secondary" onClick={() => setAdding(p)}>
                  <Plus className="h-3.5 w-3.5" /> Conectar
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {(adding || editing) && (
        <ConnectionForm
          def={adding ?? providers.data?.find((p) => p.key === editing!.provider)!}
          conn={editing}
          onClose={() => (setAdding(null), setEditing(null))}
        />
      )}
    </div>
  );
}

function ConnectionForm({ def, conn, onClose }: { def: ProviderDef; conn: Connection | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(conn?.name ?? def.label);
  const [credentials, setCredentials] = useState<Record<string, unknown>>(conn?.credentials ?? {});
  const [settings, setSettings] = useState<Record<string, unknown>>(conn?.settings ?? {});
  const save = useMutation({
    mutationFn: () =>
      conn
        ? api.patch(`/connections/${conn.id}`, { name, credentials, settings })
        : api.post("/connections", { provider: def.key, name, credentials, settings }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["wa-sessions"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${conn ? "Editar" : "Conectar"} ${def.label}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Nombre de la conexión">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {def.credentialFields.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Credenciales</p>
            <p className="mb-3 text-xs text-slate-500">Se guardan cifradas (AES-256-GCM) y nunca se vuelven a mostrar completas.</p>
            <DynamicForm fields={def.credentialFields} values={credentials} onChange={(k, v) => setCredentials({ ...credentials, [k]: v })} />
          </div>
        )}
        {def.settingsFields.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Configuración</p>
            <DynamicForm fields={def.settingsFields} values={settings} onChange={(k, v) => setSettings({ ...settings, [k]: v })} />
          </div>
        )}
        {def.key === "whatsapp_web" && <p className="text-sm text-slate-500">Tras guardar, ve al módulo WhatsApp para escanear el QR.</p>}
        {save.error && <p className="text-sm text-rose-600">{(save.error as Error).message}</p>}
      </div>
    </Modal>
  );
}

function RoutingTab() {
  const qc = useQueryClient();
  const conns = useQuery({ queryKey: ["connections"], queryFn: () => api.get<Connection[]>("/connections") });
  const routes = useQuery({ queryKey: ["routes"], queryFn: () => api.get<ChannelRoute[]>("/connections/routing/all") });
  const save = useMutation({
    mutationFn: (p: { channel: Channel; ids: string[] }) => api.put(`/connections/routing/${p.channel}`, { connectionIds: p.ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routes"] }),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Define qué proveedor entrega cada canal. El primero es el principal; los siguientes se usan como <b>respaldo automático</b> si
        el principal falla. Sin reglas, se usa cualquier conexión compatible.
      </p>
      {(["WHATSAPP", "SMS", "EMAIL", "VOICE"] as Channel[]).map((ch) => {
        const ordered = (routes.data ?? []).filter((r) => r.channel === ch).sort((a, b) => a.priority - b.priority).map((r) => r.connectionId);
        const compatible = (conns.data ?? []).filter((c) => c.channels.includes(ch));
        const available = compatible.filter((c) => !ordered.includes(c.id));
        const setOrder = (ids: string[]) => save.mutate({ channel: ch, ids });
        return (
          <div key={ch} className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <ChannelIcon channel={ch} />
              <p className="font-medium">{CHANNEL_LABEL[ch]}</p>
            </div>
            <div className="space-y-1.5">
              {ordered.map((id, i) => {
                const c = conns.data?.find((x) => x.id === id);
                return (
                  <div key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <Badge color={i === 0 ? "indigo" : "slate"}>{i === 0 ? "Principal" : `Respaldo ${i}`}</Badge>
                    <span className="flex-1">
                      {c?.name} <span className="text-xs text-slate-400">({c?.providerLabel})</span>
                    </span>
                    <button disabled={i === 0} onClick={() => setOrder(swap(ordered, i, i - 1))} className="p-1 disabled:opacity-30">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button disabled={i === ordered.length - 1} onClick={() => setOrder(swap(ordered, i, i + 1))} className="p-1 disabled:opacity-30">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setOrder(ordered.filter((x) => x !== id))} className="p-1">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              {!ordered.length && <p className="text-xs text-slate-400">Automático: {compatible.map((c) => c.name).join(", ") || "sin proveedores compatibles"}</p>}
            </div>
            {available.length > 0 && (
              <select className="input mt-2 w-64 py-1.5 text-xs" value="" onChange={(e) => e.target.value && setOrder([...ordered, e.target.value])}>
                <option value="">+ Añadir proveedor…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.providerLabel})
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {save.error && <p className="text-sm text-rose-600">{(save.error as Error).message}</p>}
    </div>
  );
}

const swap = (arr: string[], i: number, j: number) => {
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
};

function TeamTab() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", role: "AGENT" });
  const [created, setCreated] = useState<{ email: string; tempPassword?: string } | null>(null);
  const team = useQuery({ queryKey: ["team"], queryFn: () => api.get<{ id: string; userId: string; name: string; email: string; role: string }[]>("/team") });
  const add = useMutation({
    mutationFn: () => api.post<{ email: string; tempPassword?: string }>("/team", form),
    onSuccess: (r) => (setCreated(r), setForm({ name: "", email: "", role: "AGENT" }), void qc.invalidateQueries({ queryKey: ["team"] })),
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/team/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }) });
  const canManage = me?.role !== "AGENT";
  return (
    <div className="max-w-3xl space-y-6">
      <div className="card divide-y divide-slate-100">
        {team.data?.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <p className="text-sm font-medium">{m.name}</p>
              <p className="text-xs text-slate-500">{m.email}</p>
            </div>
            <Badge color={m.role === "OWNER" ? "indigo" : "slate"}>{m.role}</Badge>
            {canManage && m.role !== "OWNER" && (
              <Button size="sm" variant="ghost" onClick={() => confirm("¿Quitar del equipo?") && del.mutate(m.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <form
          className="card space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <p className="font-medium">Añadir miembro</p>
          <div className="grid grid-cols-3 gap-2">
            <input className="input" placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input" type="email" placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="AGENT">Agente</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>
          <Button loading={add.isPending}>Añadir</Button>
          {add.error && <p className="text-sm text-rose-600">{(add.error as Error).message}</p>}
          {created?.tempPassword && (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              Usuario creado. Comparte la contraseña temporal con {created.email}: <code className="font-semibold">{created.tempPassword}</code>
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function SandboxTab() {
  const [form, setForm] = useState({ channel: "WHATSAPP", from: "+5215512340000", body: "Hola, ¿cuál es el precio?", profileName: "Cliente de prueba" });
  const [ok, setOk] = useState(false);
  const sim = useMutation({ mutationFn: () => api.post("/dev/simulate-inbound", form), onSuccess: () => setOk(true) });
  const isEmail = useMemo(() => form.channel === "EMAIL", [form.channel]);
  return (
    <div className="card max-w-2xl space-y-3 p-5">
      <p className="font-medium">Simular mensaje entrante</p>
      <p className="text-sm text-slate-500">
        Prueba la bandeja y las automatizaciones sin proveedores reales: el mensaje entra como si llegara del canal elegido.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Canal">
          <select className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="SMS">SMS</option>
            <option value="EMAIL">Correo</option>
          </select>
        </Field>
        <Field label={isEmail ? "Email remitente" : "Teléfono remitente"}>
          <input className="input" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
        </Field>
        <Field label="Nombre de perfil">
          <input className="input" value={form.profileName} onChange={(e) => setForm({ ...form, profileName: e.target.value })} />
        </Field>
        <Field label="Mensaje" className="col-span-2">
          <textarea className="input" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
      </div>
      <Button loading={sim.isPending} onClick={() => (setOk(false), sim.mutate())}>
        Enviar mensaje simulado
      </Button>
      {ok && <p className="text-sm text-emerald-700">✓ Recibido. Revisa Conversaciones y el historial de tus automatizaciones.</p>}
      {sim.error && <p className="text-sm text-rose-600">{(sim.error as Error).message}</p>}
    </div>
  );
}
