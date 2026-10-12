import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertCircle, Check, CheckCheck, Clock, FileText, Inbox, Phone, Plus, Search, Send, UserPlus, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSocketEvent } from "../lib/socket";
import { CHANNEL_LABEL, fullName, initials, shortTime, dateTime } from "../lib/format";
import type { Contact, Conversation, Message, MessageChannel, Template } from "../lib/types";
import { Avatar, Badge, Button, Empty, Field, Modal, Spinner, TagPill } from "../components/ui";
import { ChannelIcon } from "../components/ChannelIcon";
import { usePhone } from "../components/Softphone";

interface Thread {
  conversation: Conversation;
  messages: Message[];
  siblings: { id: string; channel: MessageChannel; unreadCount: number }[];
}

export function InboxPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"OPEN" | "PENDING" | "CLOSED" | "ALL">("OPEN");
  const [channel, setChannel] = useState<"" | MessageChannel>("");
  const [assigned, setAssigned] = useState<"all" | "me" | "unassigned">("all");
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const params = new URLSearchParams({ status, assigned, ...(channel ? { channel } : {}), ...(q ? { q } : {}) });
  const list = useQuery({
    queryKey: ["conversations", status, channel, assigned, q],
    queryFn: () => api.get<Conversation[]>(`/conversations?${params}`),
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["conversations"] });
    void qc.invalidateQueries({ queryKey: ["thread"] });
  }, [qc]);
  useSocketEvent("message:new", refresh);
  useSocketEvent("message:status", refresh);
  useSocketEvent("conversation:update", refresh);

  return (
    <div className="flex h-full">
      {/* Lista */}
      <section className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="space-y-2 border-b border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <h1 className="font-semibold text-slate-900">Conversaciones</h1>
            <Button size="sm" variant="secondary" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Nueva
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <select className="input px-2 py-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="OPEN">Abiertas</option>
              <option value="PENDING">Pendientes</option>
              <option value="CLOSED">Cerradas</option>
              <option value="ALL">Todas</option>
            </select>
            <select className="input px-2 py-1 text-xs" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="">Canal</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">Correo</option>
            </select>
            <select className="input px-2 py-1 text-xs" value={assigned} onChange={(e) => setAssigned(e.target.value as typeof assigned)}>
              <option value="all">Todos</option>
              <option value="me">Míos</option>
              <option value="unassigned">Sin asignar</option>
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.isLoading && (
            <div className="p-6 text-center">
              <Spinner className="mx-auto" />
            </div>
          )}
          {list.data?.length === 0 && <Empty icon={<Inbox className="h-5 w-5" />} title="Sin conversaciones" text="Los mensajes entrantes de todos tus canales aparecerán aquí." />}
          {list.data?.map((c) => (
            <button
              key={c.id}
              onClick={() => nav(`/inbox/${c.id}`)}
              className={clsx(
                "flex w-full items-start gap-3 border-b border-slate-50 px-3 py-3 text-left transition hover:bg-slate-50",
                c.id === id && "bg-brand-50/60",
              )}
            >
              <div className="relative">
                <Avatar text={initials(c.contact)} />
                <span className="absolute -bottom-1 -right-1">
                  <ChannelIcon channel={c.channel} size="sm" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={clsx("truncate text-sm", c.unreadCount ? "font-semibold text-slate-900" : "text-slate-700")}>
                    {fullName(c.contact)}
                  </p>
                  <span className="shrink-0 text-[11px] text-slate-400">{shortTime(c.lastMessageAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-slate-500">{c.lastPreview}</p>
                  {c.unreadCount > 0 && (
                    <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{c.unreadCount}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Hilo */}
      {id ? (
        <ThreadView id={id} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Empty icon={<Inbox className="h-6 w-6" />} title="Selecciona una conversación" text="WhatsApp, SMS y correo en una sola bandeja." />
        </div>
      )}

      <NewConversationModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={(cid) => nav(`/inbox/${cid}`)} />
    </div>
  );
}

function StatusIcon({ m }: { m: Message }) {
  if (m.direction === "INBOUND") return null;
  const cls = "h-3.5 w-3.5";
  switch (m.status) {
    case "QUEUED":
      return <Clock className={cls} />;
    case "SENT":
      return <Check className={cls} />;
    case "DELIVERED":
      return <CheckCheck className={cls} />;
    case "READ":
      return <CheckCheck className={clsx(cls, "text-sky-300")} />;
    case "FAILED":
      return <AlertCircle className={clsx(cls, "text-rose-200")} />;
    default:
      return null;
  }
}

function ThreadView({ id }: { id: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { me } = useAuth();
  const phone = usePhone();
  const bottom = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [tplOpen, setTplOpen] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["thread", id], queryFn: () => api.get<Thread>(`/conversations/${id}`) });
  const team = useQuery({ queryKey: ["team"], queryFn: () => api.get<{ userId: string; name: string }[]>("/team") });

  useEffect(() => {
    if (data?.conversation.unreadCount) {
      void api.post(`/conversations/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ["conversations"] }));
    }
  }, [data?.conversation.unreadCount, id, qc]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [data?.messages.length]);

  const send = useMutation({
    mutationFn: (payload: { body?: string; subject?: string; templateId?: string }) =>
      api.post<Message>(`/conversations/${id}/messages`, payload),
    onSuccess: () => {
      setBody("");
      setSubject("");
      void qc.invalidateQueries({ queryKey: ["thread", id] });
    },
  });
  const patch = useMutation({
    mutationFn: (p: { status?: string; assigneeId?: string | null }) => api.patch(`/conversations/${id}`, p),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["thread", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const { conversation: conv, messages } = data;
  const isEmail = conv.channel === "EMAIL";

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex items-center gap-3">
            <ChannelIcon channel={conv.channel} />
            <div>
              <p className="font-medium text-slate-900">{fullName(conv.contact)}</p>
              <p className="text-xs text-slate-500">
                {CHANNEL_LABEL[conv.channel]} · {isEmail ? conv.contact.email : conv.contact.whatsapp || conv.contact.phone}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="input w-40 py-1.5 text-xs"
              value={conv.assigneeId ?? ""}
              onChange={(e) => patch.mutate({ assigneeId: e.target.value || null })}
            >
              <option value="">Sin asignar</option>
              {team.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === me?.user.id ? `Yo (${m.name})` : m.name}
                </option>
              ))}
            </select>
            {conv.status !== "CLOSED" ? (
              <Button size="sm" variant="secondary" onClick={() => patch.mutate({ status: "CLOSED" })}>
                <Check className="h-3.5 w-3.5" /> Cerrar
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => patch.mutate({ status: "OPEN" })}>
                Reabrir
              </Button>
            )}
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-6 py-5">
          {messages.map((m) => (
            <div key={m.id} className={clsx("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
              <div
                className={clsx(
                  "max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow-sm",
                  m.direction === "OUTBOUND"
                    ? m.status === "FAILED"
                      ? "rounded-br-sm bg-rose-600 text-white"
                      : "rounded-br-sm bg-brand-600 text-white"
                    : "rounded-bl-sm bg-white text-slate-800",
                )}
                title={m.error ?? undefined}
              >
                {m.subject && <p className="mb-1 font-semibold">{m.subject}</p>}
                {m.mediaUrl && <img src={m.mediaUrl} alt="" className="mb-2 max-h-56 rounded-lg" />}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div
                  className={clsx(
                    "mt-1 flex items-center justify-end gap-1 text-[10px]",
                    m.direction === "OUTBOUND" ? "text-white/70" : "text-slate-400",
                  )}
                >
                  {!!m.metadata?.automation && <span>⚡ auto ·</span>}
                  {m.provider && <span>{m.provider} ·</span>}
                  <span title={dateTime(m.createdAt)}>{shortTime(m.createdAt)}</span>
                  <StatusIcon m={m} />
                </div>
                {m.status === "FAILED" && m.error && <p className="mt-1 text-[11px] text-rose-100">{m.error}</p>}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>

        <form
          className="border-t border-slate-200 bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) send.mutate({ body, subject: isEmail ? subject : undefined });
          }}
        >
          {isEmail && (
            <input className="input mb-2" placeholder="Asunto" value={subject} onChange={(e) => setSubject(e.target.value)} />
          )}
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => setTplOpen(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Plantillas">
              <FileText className="h-5 w-5" />
            </button>
            <textarea
              className="input min-h-[42px] flex-1 resize-none"
              rows={Math.min(6, Math.max(1, body.split("\n").length))}
              placeholder={`Mensaje por ${CHANNEL_LABEL[conv.channel]}… (Shift+Enter: nueva línea)`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (body.trim()) send.mutate({ body, subject: isEmail ? subject : undefined });
                }
              }}
            />
            <Button loading={send.isPending} disabled={!body.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {send.error && <p className="mt-1 text-xs text-rose-600">{(send.error as Error).message}</p>}
        </form>
      </section>

      <ContactPanel
        contact={conv.contact}
        siblings={data.siblings}
        onCall={() => phone.dial(conv.contact.phone ?? "", conv.contact.id)}
        onOpen={(cid) => nav(`/inbox/${cid}`)}
      />

      <TemplatePicker
        open={tplOpen}
        channel={conv.channel}
        onClose={() => setTplOpen(false)}
        onPick={(t) => {
          setTplOpen(false);
          send.mutate({ templateId: t.id });
        }}
      />
    </>
  );
}

function ContactPanel({
  contact,
  siblings,
  onCall,
  onOpen,
}: {
  contact: Contact;
  siblings: Thread["siblings"];
  onCall: () => void;
  onOpen: (id: string) => void;
}) {
  const full = useQuery({ queryKey: ["contact", contact.id], queryFn: () => api.get<Contact>(`/contacts/${contact.id}`) });
  const c = full.data ?? contact;
  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5 xl:block">
      <div className="flex flex-col items-center text-center">
        <Avatar text={initials(c)} className="h-14 w-14 text-base" />
        <p className="mt-2 font-semibold text-slate-900">{fullName(c)}</p>
        {c.company && <p className="text-xs text-slate-500">{c.company}</p>}
        {c.optOut && (
          <Badge color="red" className="mt-2">
            Opt-out
          </Badge>
        )}
        <div className="mt-3 flex gap-2">
          {c.phone && (
            <Button size="sm" variant="secondary" onClick={onCall}>
              <Phone className="h-3.5 w-3.5" /> Llamar
            </Button>
          )}
          <Link to={`/contacts?open=${c.id}`}>
            <Button size="sm" variant="secondary">
              Ficha
            </Button>
          </Link>
        </div>
      </div>
      <dl className="mt-6 space-y-3 text-sm">
        {[
          ["Teléfono", c.phone],
          ["WhatsApp", c.whatsapp],
          ["Email", c.email],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-400">{k}</dt>
            <dd className="text-slate-700">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      {!!c.tags?.length && (
        <div className="mt-5">
          <p className="mb-2 text-xs text-slate-400">Etiquetas</p>
          <div className="flex flex-wrap gap-1">
            {c.tags.map(({ tag }) => (
              <TagPill key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </div>
        </div>
      )}
      {!!siblings.length && (
        <div className="mt-5">
          <p className="mb-2 text-xs text-slate-400">Otros canales con este contacto</p>
          <div className="space-y-1">
            {siblings.map((s) => (
              <button key={s.id} onClick={() => onOpen(s.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                <ChannelIcon channel={s.channel} size="sm" />
                <span className="flex-1 text-left">{CHANNEL_LABEL[s.channel]}</span>
                {s.unreadCount > 0 && <Badge color="indigo">{s.unreadCount}</Badge>}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function TemplatePicker({
  open,
  channel,
  onClose,
  onPick,
}: {
  open: boolean;
  channel: MessageChannel;
  onClose: () => void;
  onPick: (t: Template) => void;
}) {
  const { data } = useQuery({
    queryKey: ["templates", channel],
    queryFn: () => api.get<Template[]>(`/templates?channel=${channel}`),
    enabled: open,
  });
  return (
    <Modal open={open} onClose={onClose} title={`Plantillas de ${CHANNEL_LABEL[channel]}`}>
      {!data?.length && <p className="text-sm text-slate-500">No hay plantillas para este canal.</p>}
      <div className="space-y-2">
        {data?.map((t) => (
          <button key={t.id} onClick={() => onPick(t)} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/40">
            <p className="text-sm font-medium text-slate-900">{t.name}</p>
            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{t.body}</p>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function NewConversationModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [contact, setContact] = useState<Contact | null>(null);
  const [channel, setChannel] = useState<MessageChannel>("WHATSAPP");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const contacts = useQuery({
    queryKey: ["contacts-search", search],
    queryFn: () => api.get<{ items: Contact[] }>(`/contacts?pageSize=8&q=${encodeURIComponent(search)}`),
    enabled: open && !contact,
  });
  const start = useMutation({
    mutationFn: () => api.post<Message>("/conversations/start", { contactId: contact!.id, channel, body, subject: subject || undefined }),
    onSuccess: (m) => {
      onClose();
      setContact(null);
      setBody("");
      onCreated(m.conversationId);
    },
  });
  const available = useMemo(
    () =>
      contact
        ? (["WHATSAPP", "SMS", "EMAIL"] as MessageChannel[]).filter((ch) => (ch === "EMAIL" ? contact.email : contact.phone || contact.whatsapp))
        : [],
    [contact],
  );
  useEffect(() => {
    if (available.length && !available.includes(channel)) setChannel(available[0]);
  }, [available, channel]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva conversación"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!contact || !body.trim()} loading={start.isPending} onClick={() => start.mutate()}>
            <Send className="h-4 w-4" /> Enviar
          </Button>
        </>
      }
    >
      {!contact ? (
        <div>
          <input className="input" autoFocus placeholder="Buscar contacto…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-2 divide-y divide-slate-100">
            {contacts.data?.items.map((c) => (
              <button key={c.id} onClick={() => setContact(c)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-50">
                <Avatar text={initials(c)} />
                <div>
                  <p className="text-sm font-medium">{fullName(c)}</p>
                  <p className="text-xs text-slate-500">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                </div>
              </button>
            ))}
            {contacts.data?.items.length === 0 && (
              <p className="flex items-center gap-2 py-3 text-sm text-slate-500">
                <UserPlus className="h-4 w-4" /> Sin resultados. Crea el contacto en el módulo Contactos.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2">
            <span className="text-sm font-medium">{fullName(contact)}</span>
            <button onClick={() => setContact(null)}>
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>
          <Field label="Canal">
            <div className="flex gap-2">
              {available.map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={clsx("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", channel === ch ? "border-brand-500 bg-brand-50" : "border-slate-200")}
                >
                  <ChannelIcon channel={ch} size="sm" /> {CHANNEL_LABEL[ch]}
                </button>
              ))}
            </div>
          </Field>
          {channel === "EMAIL" && (
            <Field label="Asunto">
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          )}
          <Field label="Mensaje" help="Puedes usar variables como {{contact.firstName}}">
            <textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {start.error && <p className="text-sm text-rose-600">{(start.error as Error).message}</p>}
        </div>
      )}
    </Modal>
  );
}
