import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { FileText, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { CHANNEL_LABEL, relTime } from "../lib/format";
import type { MessageChannel, Template } from "../lib/types";
import { Badge, Button, Empty, Field, Modal, PageHeader, Spinner } from "../components/ui";
import { ChannelIcon } from "../components/ChannelIcon";

const VARIABLES = [
  "contact.firstName",
  "contact.lastName",
  "contact.fullName",
  "contact.company",
  "contact.email",
  "contact.phone",
  "workspace.name",
];

export function TemplatesPage() {
  const [channel, setChannel] = useState<"" | MessageChannel>("");
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["templates", channel],
    queryFn: () => api.get<Template[]>(`/templates${channel ? `?channel=${channel}` : ""}`),
  });
  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Plantillas"
        subtitle="Mensajes reutilizables para WhatsApp, SMS y correo con variables personalizadas"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Nueva plantilla
          </Button>
        }
      />
      <div className="mb-4 flex gap-2">
        {(["", "WHATSAPP", "SMS", "EMAIL"] as const).map((ch) => (
          <button
            key={ch}
            onClick={() => setChannel(ch)}
            className={clsx("rounded-full px-3 py-1 text-sm", channel === ch ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {ch ? CHANNEL_LABEL[ch] : "Todas"}
          </button>
        ))}
      </div>
      {isLoading && <Spinner />}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.map((t) => (
          <button key={t.id} onClick={() => setEditing(t)} className="card flex flex-col p-4 text-left transition hover:border-brand-200">
            <div className="flex items-center gap-2">
              <ChannelIcon channel={t.channel} size="sm" />
              <p className="flex-1 truncate font-medium text-slate-900">{t.name}</p>
              <Badge color={t.status === "APPROVED" ? "green" : t.status === "REJECTED" ? "red" : "yellow"}>{t.status}</Badge>
            </div>
            {t.subject && <p className="mt-2 text-xs font-medium text-slate-600">{t.subject}</p>}
            <p className="mt-2 line-clamp-4 flex-1 whitespace-pre-wrap text-sm text-slate-600">{t.body}</p>
            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
              <span>{t.category} · {t.language}</span>
              <span>{relTime(t.updatedAt)}</span>
            </div>
          </button>
        ))}
      </div>
      {data?.length === 0 && <Empty icon={<FileText className="h-5 w-5" />} title="Sin plantillas" text="Crea mensajes reutilizables para responder más rápido y lanzar campañas." />}
      {editing && <TemplateForm template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateForm({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({
    name: template?.name ?? "",
    channel: (template?.channel ?? "WHATSAPP") as MessageChannel,
    category: template?.category ?? "MARKETING",
    language: template?.language ?? "es",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
    externalId: template?.externalId ?? "",
    status: template?.status ?? "APPROVED",
  });
  const [preview, setPreview] = useState<{ body: string; subject?: string }>({ body: "" });

  useEffect(() => {
    const t = setTimeout(() => {
      api.post<{ body: string; subject?: string }>("/templates/preview", { body: form.body, subject: form.subject || undefined }).then(setPreview, () => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [form.body, form.subject]);

  const inv = () => qc.invalidateQueries({ queryKey: ["templates"] });
  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, subject: form.channel === "EMAIL" ? form.subject : null, externalId: form.externalId || null };
      return template ? api.patch(`/templates/${template.id}`, payload) : api.post("/templates", payload);
    },
    onSuccess: () => (inv(), onClose()),
  });
  const del = useMutation({ mutationFn: () => api.del(`/templates/${template!.id}`), onSuccess: () => (inv(), onClose()) });

  function insertVar(v: string) {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return setForm({ ...form, body: form.body + token });
    const start = el.selectionStart;
    const next = form.body.slice(0, start) + token + form.body.slice(el.selectionEnd);
    setForm({ ...form, body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  const limit = form.channel === "SMS" ? 160 : form.channel === "WHATSAPP" ? 1024 : null;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={template ? "Editar plantilla" : "Nueva plantilla"}
      footer={
        <>
          {template && (
            <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => confirm("¿Eliminar plantilla?") && del.mutate()}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!form.name || !form.body} loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Nombre">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="bienvenida_cliente" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Canal">
              <select className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as MessageChannel })}>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Correo</option>
              </select>
            </Field>
            <Field label="Categoría">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utilidad</option>
                <option value="AUTHENTICATION">Autenticación</option>
              </select>
            </Field>
          </div>
          {form.channel === "EMAIL" && (
            <Field label="Asunto">
              <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </Field>
          )}
          <Field label="Cuerpo">
            <textarea ref={bodyRef} className="input font-mono text-xs" rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          {limit && (
            <p className={clsx("text-right text-xs", form.body.length > limit ? "text-amber-600" : "text-slate-400")}>
              {form.body.length}/{limit} {form.channel === "SMS" && form.body.length > limit && `(${Math.ceil(form.body.length / 153)} segmentos)`}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {VARIABLES.map((v) => (
              <button key={v} type="button" onClick={() => insertVar(v)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-brand-50">
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          {form.channel === "WHATSAPP" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="ID externo (Meta)" help="Nombre de la plantilla aprobada en WhatsApp Manager">
                <input className="input" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />
              </Field>
              <Field label="Idioma">
                <input className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
        <div>
          <p className="label">Vista previa</p>
          <div className={clsx("rounded-xl p-4", form.channel === "WHATSAPP" ? "bg-[#e5ddd5]" : "bg-slate-100")}>
            {form.channel === "EMAIL" ? (
              <div className="rounded-lg bg-white p-4 shadow-sm">
                <p className="border-b border-slate-100 pb-2 text-sm font-semibold">{preview.subject || "(sin asunto)"}</p>
                <p className="whitespace-pre-wrap pt-2 text-sm text-slate-700">{preview.body}</p>
              </div>
            ) : (
              <div className={clsx("max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm whitespace-pre-wrap", form.channel === "WHATSAPP" ? "bg-[#dcf8c6]" : "bg-white")}>
                {preview.body || <span className="text-slate-400">Escribe el mensaje…</span>}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-400">Vista previa con un contacto de ejemplo.</p>
        </div>
      </div>
      {save.error && <p className="mt-3 text-sm text-rose-600">{(save.error as Error).message}</p>}
    </Modal>
  );
}
