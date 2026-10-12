import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LogOut, MessageCircle, Plus, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useSocketEvent } from "../lib/socket";
import { Badge, Button, Empty, Field, Modal, PageHeader, Spinner } from "../components/ui";

interface Session {
  id: string;
  name: string;
  provider: "whatsapp_web" | "meta_whatsapp" | "twilio";
  status: string;
  settings: Record<string, string>;
  live: { status: "connecting" | "qr" | "open" | "closed"; qr?: string; phone?: string } | null;
}

const PROVIDER_LABEL = { whatsapp_web: "WhatsApp Web (QR)", meta_whatsapp: "Meta Cloud API", twilio: "Twilio WhatsApp" };

export function WhatsAppPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [qrs, setQrs] = useState<Record<string, string | undefined>>({});
  const { data, isLoading } = useQuery({ queryKey: ["wa-sessions"], queryFn: () => api.get<Session[]>("/whatsapp/sessions") });
  const caps = useQuery({ queryKey: ["wa-caps"], queryFn: () => api.get<{ whatsappWeb: boolean }>("/whatsapp/capabilities") });
  const qrSupported = caps.data?.whatsappWeb !== false;
  const inv = () => qc.invalidateQueries({ queryKey: ["wa-sessions"] });

  useSocketEvent(
    "whatsapp:status",
    useCallback(
      (p: { connectionId: string; status: string; qr?: string }) => {
        setQrs((q) => ({ ...q, [p.connectionId]: p.status === "qr" ? p.qr : undefined }));
        void qc.invalidateQueries({ queryKey: ["wa-sessions"] });
      },
      [qc],
    ),
  );

  const start = useMutation({
    mutationFn: (id: string) => api.post<{ status: string; qr?: string }>(`/whatsapp/sessions/${id}/start`),
    onSuccess: (r, id) => {
      if (r.qr) setQrs((q) => ({ ...q, [id]: r.qr }));
      void inv();
    },
  });
  const logout = useMutation({ mutationFn: (id: string) => api.post(`/whatsapp/sessions/${id}/logout`), onSuccess: inv });

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader
        title="WhatsApp"
        subtitle="Vincula números por QR (WhatsApp Web) o usa la API oficial de Meta / Twilio. Puedes combinar varios."
        actions={
          qrSupported && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Vincular número
            </Button>
          )
        }
      />
      {!qrSupported && (
        <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          Este despliegue es serverless, así que la vinculación por QR (WhatsApp Web) no está disponible: necesita un servidor
          que mantenga la sesión abierta. Conecta WhatsApp con <b>Meta Cloud API</b> o <b>Twilio</b> en{" "}
          <Link to="/settings" className="font-medium underline">
            Ajustes → Proveedores
          </Link>
          , o despliega con Docker para usar el QR.
        </div>
      )}
      {isLoading && <Spinner />}
      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((s) => {
          const live = s.live;
          const qr = qrs[s.id] ?? live?.qr;
          const open = s.provider !== "whatsapp_web" ? s.status === "active" : live?.status === "open";
          return (
            <div key={s.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
                    <MessageCircle className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-medium text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">{PROVIDER_LABEL[s.provider]}</p>
                  </div>
                </div>
                <Badge color={open ? "green" : live?.status === "qr" ? "yellow" : "slate"}>
                  {open ? "Conectado" : live?.status === "qr" ? "Esperando QR" : live?.status === "connecting" ? "Conectando" : s.status}
                </Badge>
              </div>

              {s.provider === "whatsapp_web" ? (
                <div className="mt-4">
                  {open ? (
                    <div className="flex items-center justify-between rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                      <span className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" /> Vinculado a {s.settings.phone ?? `+${live?.phone}`}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => confirm("¿Desvincular este número?") && logout.mutate(s.id)}>
                        <LogOut className="h-3.5 w-3.5" /> Desvincular
                      </Button>
                    </div>
                  ) : qr ? (
                    <div className="flex flex-col items-center gap-3">
                      <img src={qr} alt="Código QR de WhatsApp" className="h-56 w-56 rounded-lg border border-slate-200" />
                      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
                        <li>Abre WhatsApp en tu teléfono</li>
                        <li>Ajustes → Dispositivos vinculados → Vincular un dispositivo</li>
                        <li>Escanea este código</li>
                      </ol>
                    </div>
                  ) : (
                    <Button className="w-full" variant="secondary" loading={start.isPending && start.variables === s.id} onClick={() => start.mutate(s.id)}>
                      {live?.status === "connecting" ? <RefreshCw className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}
                      {live?.status === "connecting" ? "Conectando…" : "Generar código QR"}
                    </Button>
                  )}
                  {start.error && start.variables === s.id && <p className="mt-2 text-xs text-rose-600">{(start.error as Error).message}</p>}
                </div>
              ) : (
                <p className="mt-4 text-xs text-slate-500">
                  Configuración y webhooks en <Link to="/settings" className="text-brand-600">Ajustes → Proveedores</Link>.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {data?.length === 0 && (
        <Empty
          icon={<Smartphone className="h-5 w-5" />}
          title="Ningún número de WhatsApp conectado"
          text="Vincula un número escaneando un QR o conecta la Cloud API de Meta en Ajustes."
        />
      )}
      <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <b>¿WhatsApp Web o Cloud API?</b> WhatsApp Web (QR) es ideal para empezar o para equipos pequeños: no requiere aprobación,
        pero no es una API oficial y Meta puede limitar números con envíos masivos. Para campañas y alto volumen usa la Cloud API de Meta
        (o Twilio) con plantillas aprobadas. Puedes poner ambas en el enrutamiento: una principal y otra de respaldo.
      </div>
      {adding && <AddSession onClose={() => setAdding(false)} onCreated={(id) => (setAdding(false), void inv(), start.mutate(id))} />}
    </div>
  );
}

function AddSession({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("Ventas WhatsApp");
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>("/connections", { provider: "whatsapp_web", name }),
    onSuccess: (c) => onCreated(c.id),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Vincular número por QR"
      footer={
        <Button loading={create.isPending} onClick={() => create.mutate()}>
          Continuar
        </Button>
      }
    >
      <Field label="Nombre de la línea">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="mt-3 text-xs text-slate-500">A continuación se generará un código QR para escanear desde la app de WhatsApp.</p>
      {create.error && <p className="mt-2 text-sm text-rose-600">{(create.error as Error).message}</p>}
    </Modal>
  );
}
