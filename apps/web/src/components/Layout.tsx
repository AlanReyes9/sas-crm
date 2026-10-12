import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import {
  Contact2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Phone,
  Settings,
  FileText,
  Workflow,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useSocketEvent } from "../lib/socket";
import { usePhone } from "./Softphone";

const NAV = [
  { to: "/", label: "Resumen", icon: LayoutDashboard, end: true },
  { to: "/inbox", label: "Conversaciones", icon: MessagesSquare, badge: true },
  { to: "/contacts", label: "Contactos", icon: Contact2 },
  { to: "/campaigns", label: "Campañas", icon: Megaphone },
  { to: "/phone", label: "Telefonía", icon: Phone },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { to: "/automations", label: "Automatizaciones", icon: Workflow },
  { to: "/templates", label: "Plantillas", icon: FileText },
  { to: "/settings", label: "Ajustes", icon: Settings },
];

export function Layout() {
  const { me, logout, switchWorkspace } = useAuth();
  const phone = usePhone();
  const qc = useQueryClient();
  const { data: unread } = useQuery({
    queryKey: ["unread"],
    queryFn: async () => (await api.get<{ unread: number }>("/dashboard")).unread,
    refetchInterval: 60_000,
  });
  const refreshUnread = useCallback(() => void qc.invalidateQueries({ queryKey: ["unread"] }), [qc]);
  useSocketEvent("message:new", refreshUnread);
  useSocketEvent("conversation:update", refreshUnread);

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/logo.svg" className="h-8 w-8" alt="" />
          <div>
            <p className="text-sm font-bold tracking-wide text-white">CRM NEXUS</p>
            {me && me.workspaces.length > 1 ? (
              <select
                className="-ml-1 bg-transparent text-xs text-slate-400 outline-none"
                value={me.workspace.id}
                onChange={(e) => void switchWorkspace(e.target.value)}
              >
                {me.workspaces.map((w) => (
                  <option key={w.id} value={w.id} className="text-slate-900">
                    {w.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-slate-400">{me?.workspace.name}</p>
            )}
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  isActive ? "bg-slate-800 text-white" : "hover:bg-slate-800/60 hover:text-white",
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {badge && !!unread && (
                <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-white">{unread}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <button
            onClick={phone.open}
            className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-800"
          >
            <span className={clsx("h-2 w-2 rounded-full", phone.state === "offline" ? "bg-rose-500" : "bg-emerald-400")} />
            Teléfono {phone.state === "offline" ? "desconectado" : "listo"}
          </button>
          <div className="flex items-center justify-between px-3 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{me?.user.name}</p>
              <p className="truncate text-slate-500">{me?.role}</p>
            </div>
            <button onClick={logout} className="rounded p-1.5 hover:bg-slate-800" title="Cerrar sesión">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
