import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneCall, PhoneIncoming, PhoneOutgoing, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { dateTime, duration, fullName } from "../lib/format";
import type { Call, Contact } from "../lib/types";
import { Badge, Button, Empty, PageHeader, Spinner } from "../components/ui";
import { usePhone } from "../components/Softphone";

const STATUS_COLOR: Record<string, string> = { COMPLETED: "green", NO_ANSWER: "yellow", BUSY: "yellow", FAILED: "red", CANCELED: "slate" };

export function PhonePage() {
  const phone = usePhone();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const calls = useQuery({ queryKey: ["calls"], queryFn: () => api.get<Call[]>("/calls") });
  const contacts = useQuery({
    queryKey: ["contacts-phone", q],
    queryFn: () => api.get<{ items: Contact[] }>(`/contacts?pageSize=8&q=${encodeURIComponent(q)}`),
  });
  const notes = useMutation({
    mutationFn: (p: { id: string; notes: string }) => api.patch(`/calls/${p.id}`, { notes: p.notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calls"] }),
  });

  useEffect(() => {
    const h = () => void qc.invalidateQueries({ queryKey: ["calls"] });
    window.addEventListener("nexus:calls-changed", h);
    return () => window.removeEventListener("nexus:calls-changed", h);
  }, [qc]);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Telefonía"
        subtitle={
          phone.provider === "twilio"
            ? "Llamadas desde el navegador con Twilio Voice. Las entrantes suenan en todos los agentes conectados."
            : "Modo sandbox: las llamadas se simulan. Conecta Twilio en Ajustes → Proveedores para llamadas reales."
        }
        actions={
          <Button onClick={phone.open}>
            <PhoneCall className="h-4 w-4" /> Abrir marcador
          </Button>
        }
      />
      {phone.error && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Teléfono: {phone.error}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="border-b border-slate-100 px-4 py-3 font-medium">Historial de llamadas</div>
          {calls.isLoading && <Spinner className="m-6" />}
          {calls.data?.length === 0 && <Empty icon={<PhoneCall className="h-5 w-5" />} title="Sin llamadas todavía" />}
          <div className="divide-y divide-slate-100">
            {calls.data?.map((c) => (
              <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                {c.direction === "INBOUND" ? <PhoneIncoming className="mt-0.5 h-4 w-4 text-sky-600" /> : <PhoneOutgoing className="mt-0.5 h-4 w-4 text-violet-600" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{c.contact ? fullName(c.contact) : c.direction === "INBOUND" ? c.from : c.to}</p>
                    <Badge color={STATUS_COLOR[c.status] ?? "indigo"}>{c.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {c.direction === "INBOUND" ? c.from : c.to} · {duration(c.duration)} · {dateTime(c.createdAt)}
                    {c.user && ` · ${c.user.name}`}
                  </p>
                  {c.recordingUrl && <audio controls src={c.recordingUrl} className="mt-2 h-8 w-full" />}
                  <input
                    className="mt-2 w-full border-0 border-b border-dashed border-slate-200 bg-transparent px-0 py-1 text-xs outline-none focus:border-brand-400"
                    defaultValue={c.notes ?? ""}
                    placeholder="Añadir nota…"
                    onBlur={(e) => e.target.value !== (c.notes ?? "") && notes.mutate({ id: c.id, notes: e.target.value })}
                  />
                </div>
                <Button size="sm" variant="ghost" onClick={() => phone.dial(c.direction === "INBOUND" ? c.from : c.to, c.contact?.id)}>
                  <PhoneCall className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <p className="mb-3 font-medium">Marcación rápida</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8" placeholder="Buscar contacto…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mt-2 divide-y divide-slate-100">
            {contacts.data?.items
              .filter((c) => c.phone)
              .map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm">{fullName(c)}</p>
                    <p className="text-xs text-slate-500">{c.phone}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => phone.dial(c.phone!, c.id)}>
                    <PhoneCall className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            ¿Configurar Twilio? Ve a <Link to="/settings" className="text-brand-600">Ajustes → Proveedores</Link> y asigna la conexión al canal Voz.
          </p>
        </div>
      </div>
    </div>
  );
}
