import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import clsx from "clsx";
import { BadgeCheck, CircleHelp, Filter, Phone, Plus, ShieldCheck, Tag as TagIcon, Trash2, Upload, Users, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { CHANNEL_LABEL, dateTime, duration, fullName, initials, relTime } from "../lib/format";
import type { Channel, Contact, Conversation, Segment, SegmentRules, Tag, Verification, Call } from "../lib/types";
import { Avatar, Badge, Button, Drawer, Empty, Field, Modal, PageHeader, Spinner, TagPill, Tabs } from "../components/ui";
import { ChannelIcon } from "../components/ChannelIcon";
import { usePhone } from "../components/Softphone";

type Tab = "contacts" | "segments" | "tags";

export function ContactsPage() {
  const [tab, setTab] = useState<Tab>("contacts");
  return (
    <div className="mx-auto max-w-7xl p-8">
      <PageHeader title="Contactos" subtitle="Administra tu base, etiquétala, segméntala y verifica sus canales" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "contacts", label: "Contactos" },
          { value: "segments", label: "Segmentos" },
          { value: "tags", label: "Etiquetas" },
        ]}
      />
      <div className="mt-6">
        {tab === "contacts" && <ContactsTab />}
        {tab === "segments" && <SegmentsTab />}
        {tab === "tags" && <TagsTab />}
      </div>
    </div>
  );
}

// ─────────────────────────── Contactos ───────────────────────────

function ContactsTab() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [tagId, setTagId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const openId = params.get("open");

  const search = new URLSearchParams({ page: String(page), pageSize: "50", ...(q && { q }), ...(tagId && { tagId }), ...(segmentId && { segmentId }) });
  const { data, isLoading } = useQuery({
    queryKey: ["contacts", q, tagId, segmentId, page],
    queryFn: () => api.get<{ items: Contact[]; total: number }>(`/contacts?${search}`),
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
  const segments = useQuery({ queryKey: ["segments"], queryFn: () => api.get<Segment[]>("/segments") });

  const allChecked = !!data?.items.length && data.items.every((c) => selected.includes(c.id));
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Buscar por nombre, teléfono, email…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        <select className="input w-44" value={tagId} onChange={(e) => (setTagId(e.target.value), setPage(1))}>
          <option value="">Todas las etiquetas</option>
          {tags.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="input w-48" value={segmentId} onChange={(e) => (setSegmentId(e.target.value), setPage(1))}>
          <option value="">Todos los segmentos</option>
          {segments.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          {selected.length > 0 && (
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>
              <TagIcon className="h-4 w-4" /> Etiquetar ({selected.length})
            </Button>
          )}
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Importar CSV
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Nuevo contacto
          </Button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? [] : (data?.items.map((c) => c.id) ?? []))}
                />
              </th>
              <th className="th">Nombre</th>
              <th className="th">Canales</th>
              <th className="th">Empresa</th>
              <th className="th">Etiquetas</th>
              <th className="th">Alta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="p-8 text-center">
                  <Spinner className="mx-auto" />
                </td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setParams({ open: c.id })}>
                <td className="td" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={() => setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                  />
                </td>
                <td className="td">
                  <div className="flex items-center gap-3">
                    <Avatar text={initials(c)} className="h-8 w-8" />
                    <div>
                      <p className="font-medium text-slate-900">{fullName(c)}</p>
                      <p className="text-xs text-slate-500">{c.phone ?? c.email}</p>
                    </div>
                    {c.optOut && <Badge color="red">opt-out</Badge>}
                  </div>
                </td>
                <td className="td">
                  <ChannelBadges contact={c} />
                </td>
                <td className="td text-slate-600">{c.company ?? "—"}</td>
                <td className="td">
                  <div className="flex flex-wrap gap-1">
                    {c.tags?.map(({ tag }) => (
                      <TagPill key={tag.id} name={tag.name} color={tag.color} />
                    ))}
                  </div>
                </td>
                <td className="td text-xs text-slate-500">{relTime(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 && (
          <Empty icon={<Users className="h-5 w-5" />} title="No hay contactos" text="Crea contactos o importa un CSV para empezar." />
        )}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          <span>{data?.total ?? 0} contactos</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <span>
              {page} / {pages}
            </span>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      </div>

      {editing && <ContactForm contact={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <BulkTagModal open={bulkOpen} ids={selected} onClose={() => (setBulkOpen(false), setSelected([]))} />
      {openId && (
        <ContactDrawer
          id={openId}
          onClose={() => setParams({})}
          onEdit={(c) => setEditing(c)}
          onDeleted={() => {
            setParams({});
            void qc.invalidateQueries({ queryKey: ["contacts"] });
          }}
        />
      )}
    </div>
  );
}

function verificationOf(c: Contact, ch: Channel) {
  return c.verifications?.find((v) => v.channel === ch);
}

function ChannelBadges({ contact }: { contact: Contact }) {
  const chans: Channel[] = [];
  if (contact.whatsapp || contact.phone) chans.push("WHATSAPP");
  if (contact.phone) chans.push("SMS");
  if (contact.email) chans.push("EMAIL");
  return (
    <div className="flex gap-1">
      {chans.map((ch) => {
        const v = verificationOf(contact, ch);
        return (
          <span key={ch} className="relative">
            <ChannelIcon channel={ch} size="sm" />
            {v && (
              <span
                className={clsx(
                  "absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-white",
                  v.status === "VALID" ? "bg-emerald-500" : v.status === "INVALID" ? "bg-rose-500" : "bg-slate-300",
                )}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

function VerificationIcon({ v }: { v?: Verification }) {
  if (!v) return <span className="text-xs text-slate-400">Sin verificar</span>;
  if (v.status === "VALID")
    return (
      <Badge color="green">
        <BadgeCheck className="h-3 w-3" /> Válido
      </Badge>
    );
  if (v.status === "INVALID")
    return (
      <Badge color="red">
        <XCircle className="h-3 w-3" /> Inválido
      </Badge>
    );
  return (
    <Badge>
      <CircleHelp className="h-3 w-3" /> Desconocido
    </Badge>
  );
}

interface ContactDetail extends Contact {
  conversations: Conversation[];
  calls: Call[];
  recipients: { id: string; status: string; campaign: { id: string; name: string } }[];
}

function ContactDrawer({ id, onClose, onEdit, onDeleted }: { id: string; onClose: () => void; onEdit: (c: Contact) => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const phone = usePhone();
  const { data } = useQuery({ queryKey: ["contact", id], queryFn: () => api.get<ContactDetail>(`/contacts/${id}`) });
  const verify = useMutation({
    mutationFn: () => api.post(`/contacts/${id}/verify`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contact", id] });
      void qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
  const del = useMutation({ mutationFn: () => api.del(`/contacts/${id}`), onSuccess: onDeleted });

  return (
    <Drawer open onClose={onClose} title={data ? fullName(data) : "Contacto"}>
      {!data ? (
        <div className="p-8 text-center">
          <Spinner className="mx-auto" />
        </div>
      ) : (
        <div className="space-y-6 p-5">
          <div className="flex items-center gap-4">
            <Avatar text={initials(data)} className="h-14 w-14 text-base" />
            <div className="flex-1">
              <p className="text-lg font-semibold text-slate-900">{fullName(data)}</p>
              <p className="text-sm text-slate-500">{data.company}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {data.tags?.map(({ tag }) => (
                  <TagPill key={tag.id} name={tag.name} color={tag.color} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.phone && (
              <Button size="sm" variant="secondary" onClick={() => phone.dial(data.phone!, data.id)}>
                <Phone className="h-3.5 w-3.5" /> Llamar
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => onEdit(data)}>
              Editar
            </Button>
            <Button size="sm" variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
              <ShieldCheck className="h-3.5 w-3.5" /> Verificar canales
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-600"
              onClick={() => confirm("¿Eliminar este contacto y todo su historial?") && del.mutate()}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Canales</h3>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {(
                [
                  ["WHATSAPP", data.whatsapp || data.phone],
                  ["SMS", data.phone],
                  ["VOICE", data.phone],
                  ["EMAIL", data.email],
                ] as [Channel, string | null][]
              ).map(([ch, addr]) => (
                <div key={ch} className="flex items-center gap-3 px-3 py-2">
                  <ChannelIcon channel={ch} size="sm" />
                  <span className="w-20 text-sm text-slate-600">{CHANNEL_LABEL[ch]}</span>
                  <span className="flex-1 truncate text-sm">{addr ?? <span className="text-slate-400">—</span>}</span>
                  {addr && <VerificationIcon v={verificationOf(data, ch)} />}
                </div>
              ))}
            </div>
            {data.optOut && <p className="mt-2 text-xs text-rose-600">Este contacto pidió no recibir mensajes (opt-out).</p>}
          </section>

          {Object.keys(data.customFields ?? {}).length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Campos personalizados</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(data.customFields).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-slate-400">{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Conversaciones</h3>
            {!data.conversations.length && <p className="text-sm text-slate-400">Sin conversaciones.</p>}
            {data.conversations.map((c) => (
              <button key={c.id} onClick={() => nav(`/inbox/${c.id}`)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                <ChannelIcon channel={c.channel} size="sm" />
                <span className="flex-1 truncate text-sm text-slate-600">{c.lastPreview}</span>
                <span className="text-xs text-slate-400">{relTime(c.lastMessageAt)}</span>
              </button>
            ))}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Llamadas</h3>
            {!data.calls.length && <p className="text-sm text-slate-400">Sin llamadas.</p>}
            {data.calls.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-1 text-sm">
                <span>{c.direction === "INBOUND" ? "Entrante" : "Saliente"} · {c.status}</span>
                <span className="text-xs text-slate-400">
                  {duration(c.duration)} · {dateTime(c.createdAt)}
                </span>
              </div>
            ))}
          </section>

          {!!data.recipients.length && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Campañas</h3>
              {data.recipients.map((r) => (
                <div key={r.id} className="flex justify-between py-1 text-sm">
                  <span>{r.campaign.name}</span>
                  <Badge>{r.status}</Badge>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ContactForm({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    whatsapp: contact?.whatsapp ?? "",
    company: contact?.company ?? "",
    notes: contact?.notes ?? "",
    tags: contact?.tags?.map((t) => t.tag.name).join(", ") ?? "",
    optOut: contact?.optOut ?? false,
  });
  const [custom, setCustom] = useState(
    Object.entries(contact?.customFields ?? {}).map(([k, v]) => ({ k, v: String(v) })),
  );
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        email: form.email || null,
        phone: form.phone || null,
        whatsapp: form.whatsapp || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        customFields: Object.fromEntries(custom.filter((c) => c.k).map((c) => [c.k, c.v])),
      };
      return contact ? api.patch(`/contacts/${contact.id}`, payload) : api.post("/contacts", payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      void qc.invalidateQueries({ queryKey: ["contact"] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal
      open
      onClose={onClose}
      title={contact ? "Editar contacto" : "Nuevo contacto"}
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nombre">
          <input className="input" value={form.firstName} onChange={set("firstName")} />
        </Field>
        <Field label="Apellidos">
          <input className="input" value={form.lastName} onChange={set("lastName")} />
        </Field>
        <Field label="Teléfono" help="Formato internacional: +52 55…">
          <input className="input" value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="WhatsApp" help="Solo si es distinto del teléfono">
          <input className="input" value={form.whatsapp} onChange={set("whatsapp")} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Empresa">
          <input className="input" value={form.company} onChange={set("company")} />
        </Field>
        <Field label="Etiquetas (separadas por coma)" className="col-span-2">
          <input className="input" value={form.tags} onChange={set("tags")} placeholder="cliente, vip" />
        </Field>
        <Field label="Notas" className="col-span-2">
          <textarea className="input" rows={2} value={form.notes} onChange={set("notes")} />
        </Field>
        <div className="col-span-2">
          <span className="label">Campos personalizados</span>
          {custom.map((c, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input className="input" placeholder="clave" value={c.k} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
              <input className="input" placeholder="valor" value={c.v} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
              <Button variant="ghost" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setCustom([...custom, { k: "", v: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Añadir campo
          </Button>
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.optOut} onChange={(e) => setForm({ ...form, optOut: e.target.checked })} />
          Opt-out (no enviar mensajes de marketing)
        </label>
      </div>
      {save.error && <p className="mt-3 text-sm text-rose-600">{(save.error as Error).message}</p>}
    </Modal>
  );
}

const FIELD_ALIASES: Record<string, string[]> = {
  firstName: ["firstname", "nombre", "first name", "name"],
  lastName: ["lastname", "apellido", "apellidos", "last name"],
  email: ["email", "correo", "e-mail", "mail"],
  phone: ["phone", "telefono", "teléfono", "celular", "movil", "móvil", "tel"],
  whatsapp: ["whatsapp", "wa"],
  company: ["company", "empresa", "compañía", "organizacion"],
};

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [tags, setTags] = useState("");
  const imp = useMutation({
    mutationFn: () =>
      api.post<{ created: number; updated: number; errors: { row: number; error: string }[] }>("/contacts/import", {
        rows: rows.map((r) => Object.fromEntries(Object.entries(mapping).filter(([, col]) => col).map(([f, col]) => [f, r[col] || undefined]))),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["contacts"] }),
  });

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hs = res.meta.fields ?? [];
        setHeaders(hs);
        setRows(res.data);
        const auto: Record<string, string> = {};
        for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
          const h = hs.find((x) => aliases.includes(x.trim().toLowerCase()));
          if (h) auto[field] = h;
        }
        setMapping(auto);
      },
    });
  }

  const close = () => {
    setRows([]);
    setHeaders([]);
    imp.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Importar contactos desde CSV"
      footer={
        imp.data ? (
          <Button onClick={close}>Listo</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancelar
            </Button>
            <Button disabled={!rows.length} loading={imp.isPending} onClick={() => imp.mutate()}>
              Importar {rows.length || ""}
            </Button>
          </>
        )
      }
    >
      {imp.data ? (
        <div className="space-y-2 text-sm">
          <p>
            ✅ {imp.data.created} creados · {imp.data.updated} actualizados
          </p>
          {imp.data.errors.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded bg-rose-50 p-2 text-xs text-rose-700">
              {imp.data.errors.map((e) => (
                <p key={e.row}>
                  Fila {e.row}: {e.error}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
          {headers.length > 0 && (
            <>
              <p className="text-sm text-slate-600">{rows.length} filas detectadas. Revisa el mapeo de columnas:</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.keys(FIELD_ALIASES).map((f) => (
                  <Field key={f} label={f}>
                    <select className="input" value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}>
                      <option value="">— ignorar —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
              <Field label="Etiquetas para todos (opcional)">
                <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="importado, feria-2026" />
              </Field>
            </>
          )}
          {imp.error && <p className="text-sm text-rose-600">{(imp.error as Error).message}</p>}
        </div>
      )}
    </Modal>
  );
}

function BulkTagModal({ open, ids, onClose }: { open: boolean; ids: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [tags, setTags] = useState("");
  const [remove, setRemove] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post("/contacts/bulk-tag", { contactIds: ids, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), remove }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      setTags("");
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Etiquetar ${ids.length} contactos`}
      footer={
        <Button loading={m.isPending} disabled={!tags.trim()} onClick={() => m.mutate()}>
          Aplicar
        </Button>
      }
    >
      <Field label="Etiquetas (separadas por coma)">
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> Quitar en lugar de añadir
      </label>
    </Modal>
  );
}

// ─────────────────────────── Segmentos ───────────────────────────

const SEGMENT_FIELDS = [
  { value: "tag", label: "Etiqueta", ops: ["has", "not_has"] },
  { value: "hasChannel", label: "Tiene canal", ops: ["has", "not_has"], choices: ["WHATSAPP", "SMS", "EMAIL"] },
  { value: "verified", label: "Canal verificado", ops: ["has", "not_has"], choices: ["WHATSAPP", "SMS", "EMAIL", "VOICE"] },
  { value: "firstName", label: "Nombre", ops: ["equals", "contains", "starts_with", "is_empty", "is_not_empty"] },
  { value: "email", label: "Email", ops: ["contains", "equals", "is_empty", "is_not_empty"] },
  { value: "phone", label: "Teléfono", ops: ["starts_with", "contains", "is_empty", "is_not_empty"] },
  { value: "company", label: "Empresa", ops: ["equals", "contains", "is_empty", "is_not_empty"] },
  { value: "createdAt", label: "Fecha de alta", ops: ["in_last_days", "before", "after"] },
  { value: "optOut", label: "Opt-out", ops: ["equals"], choices: ["true", "false"] },
  { value: "custom", label: "Campo personalizado…", ops: ["equals", "not_equals", "contains", "is_empty", "is_not_empty"] },
];

const OP_LABEL: Record<string, string> = {
  has: "tiene",
  not_has: "no tiene",
  equals: "es igual a",
  not_equals: "es distinto de",
  contains: "contiene",
  starts_with: "empieza por",
  is_empty: "está vacío",
  is_not_empty: "no está vacío",
  in_last_days: "en los últimos N días",
  before: "antes de",
  after: "después de",
};

function SegmentsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Segment | "new" | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["segments"], queryFn: () => api.get<Segment[]>("/segments") });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/segments/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["segments"] }) });
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Nuevo segmento
        </Button>
      </div>
      {isLoading && <Spinner />}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.map((s) => (
          <div key={s.id} className="card p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-slate-900">{s.name}</p>
                {s.description && <p className="text-xs text-slate-500">{s.description}</p>}
              </div>
              <Badge color="indigo">{s.count} contactos</Badge>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-slate-600">
              {s.rules.conditions.map((c, i) => (
                <li key={i} className="flex items-center gap-1">
                  <Filter className="h-3 w-3 text-slate-400" />
                  {i > 0 && <span className="font-medium">{s.rules.match === "all" ? "Y" : "O"}</span>} {c.field} {OP_LABEL[c.op]} {String(c.value ?? "")}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                Editar
              </Button>
              <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => confirm("¿Eliminar segmento?") && del.mutate(s.id)}>
                Eliminar
              </Button>
            </div>
          </div>
        ))}
      </div>
      {data?.length === 0 && <Empty icon={<Filter className="h-5 w-5" />} title="Sin segmentos" text="Agrupa contactos con reglas dinámicas para usarlos en campañas." />}
      {editing && <SegmentForm segment={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SegmentForm({ segment, onClose }: { segment: Segment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [rules, setRules] = useState<SegmentRules>(segment?.rules ?? { match: "all", conditions: [{ field: "tag", op: "has", value: "" }] });
  const [preview, setPreview] = useState<{ count: number; sample: Contact[] } | null>(null);
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });

  const valid = useMemo(() => rules.conditions.every((c) => c.field && c.op && !c.field.endsWith(".")), [rules]);
  useEffect(() => {
    if (!valid) return;
    const t = setTimeout(() => {
      api.post<{ count: number; sample: Contact[] }>("/segments/preview", { rules }).then(setPreview, () => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [rules, valid]);

  const save = useMutation({
    mutationFn: () => (segment ? api.patch(`/segments/${segment.id}`, { name, description, rules }) : api.post("/segments", { name, description, rules })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["segments"] });
      onClose();
    },
  });
  const update = (i: number, patch: Partial<SegmentRules["conditions"][number]>) =>
    setRules({ ...rules, conditions: rules.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={segment ? "Editar segmento" : "Nuevo segmento"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!name} loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nombre">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descripción">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm">
        Coinciden
        <select className="input w-24 py-1" value={rules.match} onChange={(e) => setRules({ ...rules, match: e.target.value as "all" | "any" })}>
          <option value="all">todas</option>
          <option value="any">alguna</option>
        </select>
        las condiciones:
      </div>
      <div className="mt-3 space-y-2">
        {rules.conditions.map((c, i) => {
          const isCustom = c.field.startsWith("custom");
          const def = SEGMENT_FIELDS.find((f) => f.value === (isCustom ? "custom" : c.field)) ?? SEGMENT_FIELDS[0];
          return (
            <div key={i} className="flex gap-2">
              <select
                className="input w-44"
                value={isCustom ? "custom" : c.field}
                onChange={(e) => {
                  const f = SEGMENT_FIELDS.find((x) => x.value === e.target.value)!;
                  update(i, { field: f.value === "custom" ? "custom." : f.value, op: f.ops[0], value: "" });
                }}
              >
                {SEGMENT_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              {isCustom && (
                <input className="input w-32" placeholder="clave" value={c.field.slice(7)} onChange={(e) => update(i, { field: `custom.${e.target.value}` })} />
              )}
              <select className="input w-44" value={c.op} onChange={(e) => update(i, { op: e.target.value })}>
                {def.ops.map((o) => (
                  <option key={o} value={o}>
                    {OP_LABEL[o]}
                  </option>
                ))}
              </select>
              {!["is_empty", "is_not_empty"].includes(c.op) &&
                (c.field === "tag" ? (
                  <select className="input flex-1" value={String(c.value ?? "")} onChange={(e) => update(i, { value: e.target.value })}>
                    <option value="">Elige…</option>
                    {tags.data?.map((t) => (
                      <option key={t.id}>{t.name}</option>
                    ))}
                  </select>
                ) : def.choices ? (
                  <select className="input flex-1" value={String(c.value ?? "")} onChange={(e) => update(i, { value: e.target.value })}>
                    <option value="">Elige…</option>
                    {def.choices.map((ch) => (
                      <option key={ch}>{ch}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input flex-1"
                    type={c.op === "before" || c.op === "after" ? "date" : c.op === "in_last_days" ? "number" : "text"}
                    value={String(c.value ?? "")}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                ))}
              <Button variant="ghost" onClick={() => setRules({ ...rules, conditions: rules.conditions.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button size="sm" variant="ghost" onClick={() => setRules({ ...rules, conditions: [...rules.conditions, { field: "tag", op: "has", value: "" }] })}>
          <Plus className="h-3.5 w-3.5" /> Añadir condición
        </Button>
      </div>
      {preview && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">{preview.count} contactos coinciden</p>
          <p className="mt-1 text-xs text-slate-500">{preview.sample.map(fullName).join(", ")}</p>
        </div>
      )}
      {save.error && <p className="mt-3 text-sm text-rose-600">{(save.error as Error).message}</p>}
    </Modal>
  );
}

// ─────────────────────────── Etiquetas ───────────────────────────

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6", "#ec4899", "#64748b"];

function TagsTab() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const { data } = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
  const inv = () => qc.invalidateQueries({ queryKey: ["tags"] });
  const create = useMutation({ mutationFn: () => api.post("/tags", { name, color }), onSuccess: () => (setName(""), inv()) });
  const patch = useMutation({ mutationFn: (p: { id: string; color: string }) => api.patch(`/tags/${p.id}`, { color: p.color }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/tags/${id}`), onSuccess: inv });
  return (
    <div className="max-w-2xl">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input className="input" placeholder="Nueva etiqueta" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button type="button" key={c} onClick={() => setColor(c)} className={clsx("h-6 w-6 rounded-full", color === c && "ring-2 ring-slate-400 ring-offset-2")} style={{ background: c }} />
          ))}
        </div>
        <Button loading={create.isPending}>Crear</Button>
      </form>
      {create.error && <p className="mb-2 text-sm text-rose-600">{(create.error as Error).message}</p>}
      <div className="card divide-y divide-slate-100">
        {data?.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <TagPill name={t.name} color={t.color} />
            <span className="flex-1 text-xs text-slate-500">{t._count?.contacts ?? 0} contactos</span>
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button key={c} onClick={() => patch.mutate({ id: t.id, color: c })} className="h-4 w-4 rounded-full" style={{ background: c }} aria-label={c} />
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => confirm(`¿Eliminar la etiqueta "${t.name}"?`) && del.mutate(t.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {data?.length === 0 && <Empty title="Sin etiquetas" />}
      </div>
    </div>
  );
}
