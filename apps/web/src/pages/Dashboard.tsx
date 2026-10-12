import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useState } from "react";
import { Contact2, Megaphone, MessagesSquare, Phone, PlugZap, Workflow } from "lucide-react";
import { api } from "../lib/api";
import { CHANNEL_LABEL } from "../lib/format";
import { Badge, PageHeader, Spinner } from "../components/ui";
import { ChannelIcon } from "../components/ChannelIcon";
import type { Channel } from "../lib/types";

interface Stats {
  contacts: number;
  openConversations: number;
  unread: number;
  activeWorkflows: number;
  runningCampaigns: number;
  callsToday: number;
  byChannel: { channel: Channel; direction: string; count: number }[];
  daily: { day: string; inbound: number; outbound: number }[];
  connections: { id: string; name: string; provider: string; status: string }[];
}

// Paleta categórica validada (slots 1 y 2): entrantes azul, salientes naranja.
const SERIES = { inbound: "#2a78d6", outbound: "#eb6834" };

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Stats>("/dashboard") });
  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const tiles = [
    { label: "Contactos", value: data.contacts, icon: Contact2, to: "/contacts" },
    { label: "Conversaciones abiertas", value: data.openConversations, sub: `${data.unread} sin leer`, icon: MessagesSquare, to: "/inbox" },
    { label: "Llamadas hoy", value: data.callsToday, icon: Phone, to: "/phone" },
    { label: "Campañas en curso", value: data.runningCampaigns, icon: Megaphone, to: "/campaigns" },
    { label: "Automatizaciones activas", value: data.activeWorkflows, icon: Workflow, to: "/automations" },
  ];
  const channels = (["WHATSAPP", "SMS", "EMAIL"] as Channel[]).map((ch) => ({
    channel: ch,
    inbound: data.byChannel.find((r) => r.channel === ch && r.direction === "INBOUND")?.count ?? 0,
    outbound: data.byChannel.find((r) => r.channel === ch && r.direction === "OUTBOUND")?.count ?? 0,
  }));

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader title="Resumen" subtitle="Actividad de los últimos 14 días en todos tus canales" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="card p-4 transition hover:border-brand-200">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">{t.label}</span>
              <t.icon className="h-4 w-4" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{t.value.toLocaleString("es")}</p>
            {t.sub && <p className="mt-0.5 text-xs text-slate-500">{t.sub}</p>}
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium text-slate-900">Mensajes por día</h2>
            <div className="flex gap-4 text-xs text-slate-600">
              <Legend color={SERIES.inbound} label="Entrantes" />
              <Legend color={SERIES.outbound} label="Salientes" />
            </div>
          </div>
          <DailyChart daily={data.daily} />
        </div>
        <div className="card p-5">
          <h2 className="mb-4 font-medium text-slate-900">Por canal</h2>
          <ul className="space-y-3">
            {channels.map((c) => (
              <li key={c.channel} className="flex items-center gap-3">
                <ChannelIcon channel={c.channel} />
                <span className="flex-1 text-sm text-slate-700">{CHANNEL_LABEL[c.channel]}</span>
                <span className="text-xs tabular-nums text-slate-500">
                  {c.inbound} ↓ · {c.outbound} ↑
                </span>
              </li>
            ))}
          </ul>
          <h2 className="mb-3 mt-6 flex items-center gap-2 font-medium text-slate-900">
            <PlugZap className="h-4 w-4" /> Proveedores
          </h2>
          <ul className="space-y-2">
            {data.connections.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{c.name}</span>
                <Badge color={c.status === "active" ? "green" : c.status === "error" ? "red" : "yellow"}>{c.status}</Badge>
              </li>
            ))}
            {!data.connections.length && (
              <Link to="/settings" className="text-sm text-brand-600">
                Conecta tu primer proveedor →
              </Link>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Barras agrupadas (entrantes/salientes) por día, con tooltip al pasar el ratón. */
function DailyChart({ daily }: { daily: Stats["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 13 + i);
    const row = daily.find((r) => new Date(r.day).toDateString() === d.toDateString());
    return { date: d, inbound: row?.inbound ?? 0, outbound: row?.outbound ?? 0 };
  });
  const max = Math.max(1, ...days.flatMap((d) => [d.inbound, d.outbound]));
  const ticks = [max, Math.round(max / 2), 0];

  return (
    <div className="flex gap-2">
      <div className="flex h-48 flex-col justify-between text-right text-[10px] tabular-nums text-slate-400">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48">
          {ticks.map((t, i) => (
            <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ top: `${(i / 2) * 100}%` }} />
          ))}
        </div>
        <div className="relative flex h-48 items-end">
          {days.map((d, i) => (
            <div
              key={i}
              className="relative flex h-full flex-1 items-end justify-center gap-[2px] px-[3px]"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && <div className="absolute inset-0 rounded bg-slate-100/70" />}
              {(["inbound", "outbound"] as const).map((k) => (
                <div
                  key={k}
                  className="relative w-full max-w-[10px] rounded-t-[4px]"
                  style={{ height: `${(d[k] / max) * 100}%`, minHeight: d[k] ? 2 : 0, background: SERIES[k] }}
                />
              ))}
              {hover === i && (
                <div className="absolute bottom-full z-10 mb-2 w-32 rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-lg">
                  <p className="mb-1 font-medium text-slate-900">{format(d.date, "EEE d MMM", { locale: es })}</p>
                  <p className="flex justify-between text-slate-600">
                    <Legend color={SERIES.inbound} label="Entrantes" />
                    <span className="tabular-nums">{d.inbound}</span>
                  </p>
                  <p className="flex justify-between text-slate-600">
                    <Legend color={SERIES.outbound} label="Salientes" />
                    <span className="tabular-nums">{d.outbound}</span>
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-1 flex text-[10px] text-slate-400">
          {days.map((d, i) => (
            <span key={i} className="flex-1 text-center">
              {i % 2 === 0 ? format(d.date, "d/M") : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
