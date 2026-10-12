import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Megaphone, Pause, Play, Plus, Trash2, Users } from "lucide-react";
import { api } from "../lib/api";
import { useSocketEvent } from "../lib/socket";
import { CHANNEL_LABEL, dateTime, fullName, relTime } from "../lib/format";
import type { Campaign, CampaignStats, MessageChannel, Segment, Tag, Template } from "../lib/types";
import { Badge, Button, Empty, Field, Modal, PageHeader, Spinner } from "../components/ui";
import { ChannelIcon } from "../components/ChannelIcon";

const STATUS: Record<Campaign["status"], { label: string; color: string }> = {
  DRAFT: { label: "Borrador", color: "slate" },
  SCHEDULED: { label: "Programada", color: "blue" },
  RUNNING: { label: "Enviando", color: "indigo" },
  COMPLETED: { label: "Completada", color: "green" },
  PAUSED: { label: "Pausada", color: "yellow" },
  FAILED: { label: "Fallida", color: "red" },
};

function Progress({ stats }: { stats: CampaignStats }) {
  const total = stats.total || 1;
  const seg = [
    { v: stats.DELIVERED, cls: "bg-emerald-500", label: "Entregados" },
    { v: stats.SENT, cls: "bg-brand-500", label: "Enviados" },
    { v: stats.FAILED, cls: "bg-rose-500", label: "Fallidos" },
    { v: stats.SKIPPED, cls: "bg-slate-300", label: "Omitidos" },
  ];
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-slate-100">
        {seg.map((s) => s.v > 0 && <div key={s.label} className={s.cls} style={{ width: `${(s.v / total) * 100}%` }} title={`${s.label}: ${s.v}`} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
        {seg.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className={clsx("h-2 w-2 rounded-full", s.cls)} />
            {s.label} {s.v}
          </span>
        ))}
        <span>Pendientes {stats.PENDING}</span>
      </div>
    </div>
  );
}

export function CampaignsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["campaigns"], queryFn: () => api.get<Campaign[]>("/campaigns") });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["campaigns"] });
    void qc.invalidateQueries({ queryKey: ["campaign"] });
  }, [qc]);
  useSocketEvent("campaign:progress", refresh);
  useSocketEvent("campaign:update", refresh);
  useSocketEvent("message:status", refresh);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Campañas"
        subtitle="Envíos masivos por WhatsApp, SMS o correo a segmentos y etiquetas"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nueva campaña
          </Button>
        }
      />
      {isLoading && <Spinner />}
      <div className="space-y-3">
        {data?.map((c) => (
          <button key={c.id} onClick={() => setOpenId(c.id)} className="card block w-full p-4 text-left transition hover:border-brand-200">
            <div className="flex items-center gap-3">
              <ChannelIcon channel={c.channel} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-500">
                  {c.template ? `Plantilla: ${c.template.name}` : "Mensaje libre"} ·{" "}
                  {c.scheduledAt && c.status === "SCHEDULED" ? `programada ${dateTime(c.scheduledAt)}` : `creada ${relTime(c.createdAt)}`}
                </p>
              </div>
              <Badge color={STATUS[c.status].color}>{STATUS[c.status].label}</Badge>
            </div>
            {c.stats.total > 0 && (
              <div className="mt-3">
                <Progress stats={c.stats} />
              </div>
            )}
          </button>
        ))}
      </div>
      {data?.length === 0 && (
        <Empty icon={<Megaphone className="h-5 w-5" />} title="Aún no hay campañas" text="Crea tu primera campaña y elige a quién y por qué canal enviarla." />
      )}
      {creating && <CampaignForm onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), setOpenId(id))} />}
      {openId && <CampaignDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function MultiPick<T extends { id: string; name: string }>({ items, value, onChange, extra }: { items: T[]; value: string[]; onChange: (v: string[]) => void; extra?: (i: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => {
        const on = value.includes(i.id);
        return (
          <button
            type="button"
            key={i.id}
            onClick={() => onChange(on ? value.filter((x) => x !== i.id) : [...value, i.id])}
            className={clsx("rounded-full border px-2.5 py-1 text-xs", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600")}
          >
            {i.name}
            {extra && <span className="ml-1 text-slate-400">{extra(i)}</span>}
          </button>
        );
      })}
      {!items.length && <span className="text-xs text-slate-400">No hay elementos</span>}
    </div>
  );
}

function CampaignForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<MessageChannel>("WHATSAPP");
  const [mode, setMode] = useState<"template" | "free">("template");
  const [templateId, setTemplateId] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [segmentIds, setSegmentIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [schedule, setSchedule] = useState("");
  const [rate, setRate] = useState(60);
  const [reach, setReach] = useState<{ total: number; reachable: number } | null>(null);

  const templates = useQuery({ queryKey: ["templates", channel], queryFn: () => api.get<Template[]>(`/templates?channel=${channel}`) });
  const segments = useQuery({ queryKey: ["segments"], queryFn: () => api.get<Segment[]>("/segments") });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .post<{ total: number; reachable: number }>("/campaigns/audience-preview", { channel, audience: { segmentIds, tagIds, contactIds: [], all } })
        .then(setReach, () => setReach(null));
    }, 250);
    return () => clearTimeout(t);
  }, [channel, segmentIds, tagIds, all]);

  const create = useMutation({
    mutationFn: () =>
      api.post<Campaign>("/campaigns", {
        name,
        channel,
        templateId: mode === "template" ? templateId || null : null,
        body: mode === "free" ? body : null,
        subject: mode === "free" && channel === "EMAIL" ? subject : null,
        audience: { segmentIds, tagIds, contactIds: [], all },
        scheduledAt: schedule ? new Date(schedule).toISOString() : null,
        ratePerMin: rate,
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
      onCreated(c.id);
    },
  });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Nueva campaña"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!name || (mode === "template" ? !templateId : !body) || (!all && !segmentIds.length && !tagIds.length)}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            {schedule ? "Programar" : "Guardar borrador"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Nombre de la campaña">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Promo de verano" />
        </Field>
        <Field label="Canal">
          <div className="flex gap-2">
            {(["WHATSAPP", "SMS", "EMAIL"] as MessageChannel[]).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => (setChannel(ch), setTemplateId(""))}
                className={clsx("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", channel === ch ? "border-brand-500 bg-brand-50" : "border-slate-200")}
              >
                <ChannelIcon channel={ch} size="sm" /> {CHANNEL_LABEL[ch]}
              </button>
            ))}
          </div>
        </Field>
        <div>
          <div className="mb-2 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "template"} onChange={() => setMode("template")} /> Usar plantilla
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "free"} onChange={() => setMode("free")} /> Mensaje libre
            </label>
          </div>
          {mode === "template" ? (
            <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Elige una plantilla…</option>
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="space-y-2">
              {channel === "EMAIL" && <input className="input" placeholder="Asunto" value={subject} onChange={(e) => setSubject(e.target.value)} />}
              <textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hola {{contact.firstName}}…" />
            </div>
          )}
          {mode === "template" && channel === "WHATSAPP" && (
            <p className="mt-1 text-xs text-slate-500">
              Fuera de la ventana de 24 h, Meta exige plantillas aprobadas: indica su nombre en “ID externo” de la plantilla.
            </p>
          )}
        </div>
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" /> Destinatarios
            </span>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Todos los contactos
            </label>
          </div>
          {!all && (
            <>
              <Field label="Segmentos">
                <MultiPick items={segments.data ?? []} value={segmentIds} onChange={setSegmentIds} extra={(s) => String(s.count ?? "")} />
              </Field>
              <Field label="Etiquetas">
                <MultiPick items={tags.data ?? []} value={tagIds} onChange={setTagIds} extra={(t) => String(t._count?.contacts ?? "")} />
              </Field>
            </>
          )}
          {reach && (
            <p className="text-xs text-slate-600">
              <b>{reach.reachable}</b> alcanzables por {CHANNEL_LABEL[channel]} de {reach.total} contactos seleccionados (se omiten opt-out y sin dirección).
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Programar envío (opcional)">
            <input className="input" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          </Field>
          <Field label="Velocidad (mensajes/minuto)" help="Respeta los límites de tu proveedor">
            <input className="input" type="number" min={1} max={6000} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
          </Field>
        </div>
        {create.error && <p className="text-sm text-rose-600">{(create.error as Error).message}</p>}
      </div>
    </Modal>
  );
}

interface CampaignFull extends Campaign {
  template: Template | null;
  recipients: {
    id: string;
    status: string;
    error: string | null;
    sentAt: string | null;
    contact: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null };
  }[];
}

function CampaignDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["campaign", id], queryFn: () => api.get<CampaignFull>(`/campaigns/${id}`) });
  const inv = () => {
    void qc.invalidateQueries({ queryKey: ["campaign", id] });
    void qc.invalidateQueries({ queryKey: ["campaigns"] });
  };
  const launch = useMutation({ mutationFn: () => api.post(`/campaigns/${id}/launch`), onSuccess: inv });
  const pause = useMutation({ mutationFn: () => api.post(`/campaigns/${id}/pause`), onSuccess: inv });
  const del = useMutation({ mutationFn: () => api.del(`/campaigns/${id}`), onSuccess: () => (inv(), onClose()) });
  const err = (launch.error || pause.error || del.error) as Error | null;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={data?.name ?? "Campaña"}
      footer={
        data && (
          <>
            {data.status !== "RUNNING" && (
              <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => confirm("¿Eliminar campaña?") && del.mutate()}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {data.status === "RUNNING" ? (
              <Button variant="secondary" loading={pause.isPending} onClick={() => pause.mutate()}>
                <Pause className="h-4 w-4" /> Pausar
              </Button>
            ) : ["DRAFT", "SCHEDULED", "PAUSED"].includes(data.status) ? (
              <Button loading={launch.isPending} onClick={() => launch.mutate()}>
                <Play className="h-4 w-4" /> {data.status === "PAUSED" ? "Reanudar" : "Enviar ahora"}
              </Button>
            ) : null}
          </>
        )
      }
    >
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <ChannelIcon channel={data.channel} />
            <Badge color={STATUS[data.status].color}>{STATUS[data.status].label}</Badge>
            <span className="text-xs text-slate-500">{data.ratePerMin} msg/min</span>
            {data.startedAt && <span className="text-xs text-slate-500">Inicio {dateTime(data.startedAt)}</span>}
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700">{data.template?.body ?? data.body}</div>
          {data.stats.total > 0 && <Progress stats={data.stats} />}
          {err && <p className="text-sm text-rose-600">{err.message}</p>}
          {data.recipients.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="th">Contacto</th>
                    <th className="th">Estado</th>
                    <th className="th">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recipients.map((r) => (
                    <tr key={r.id}>
                      <td className="td">
                        {fullName(r.contact)} <span className="text-xs text-slate-400">{r.contact.phone ?? r.contact.email}</span>
                      </td>
                      <td className="td">
                        <Badge color={r.status === "FAILED" ? "red" : r.status === "DELIVERED" ? "green" : r.status === "SKIPPED" ? "slate" : "indigo"}>{r.status}</Badge>
                      </td>
                      <td className="td text-xs text-slate-500">{r.error ?? (r.sentAt ? relTime(r.sentAt) : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
