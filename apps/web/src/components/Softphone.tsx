import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Call as TwilioCall, Device } from "@twilio/voice-sdk";
import { Delete, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { duration } from "../lib/format";

interface TokenResponse {
  token: string;
  identity: string;
  provider: string;
  callerId?: string;
}

type PhoneState = "offline" | "ready" | "connecting" | "ringing" | "in-call" | "incoming";

interface PhoneCtx {
  state: PhoneState;
  provider: string | null;
  error: string | null;
  dial: (to: string, contactId?: string) => void;
  open: () => void;
}

const Ctx = createContext<PhoneCtx>({ state: "offline", provider: null, error: null, dial: () => undefined, open: () => undefined });
export const usePhone = () => useContext(Ctx);

/**
 * Softphone global. Con Twilio registra un Device del Voice JS SDK para hacer y
 * recibir llamadas en el navegador. Con el sandbox simula las llamadas.
 */
export function PhoneProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PhoneState>("offline");
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [number, setNumber] = useState("");
  const [peer, setPeer] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const device = useRef<Device | null>(null);
  const call = useRef<TwilioCall | null>(null);
  const simulated = useRef<{ to: string; contactId?: string; started: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await api.get<TokenResponse>("/calls/token");
        if (cancelled) return;
        setProvider(t.provider);
        if (t.provider !== "twilio") {
          setState("ready");
          return;
        }
        const { Device } = await import("@twilio/voice-sdk");
        const d = new Device(t.token, { logLevel: "error", codecPreferences: ["opus", "pcmu"] as never });
        d.on("registered", () => setState("ready"));
        d.on("error", (e: { message: string }) => setError(e.message));
        d.on("tokenWillExpire", async () => {
          const fresh = await api.get<TokenResponse>("/calls/token");
          d.updateToken(fresh.token);
        });
        d.on("incoming", (c: TwilioCall) => {
          call.current = c;
          setPeer(c.parameters.From ?? "Desconocido");
          setState("incoming");
          setVisible(true);
          bindCall(c);
        });
        await d.register();
        device.current = d;
      } catch (e) {
        setError((e as Error).message);
        setState("offline");
      }
    })();
    return () => {
      cancelled = true;
      device.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (state !== "in-call") return;
    setSeconds(0);
    const i = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [state]);

  function bindCall(c: TwilioCall) {
    c.on("accept", () => setState("in-call"));
    c.on("ringing", () => setState("ringing"));
    const end = () => {
      call.current = null;
      setMuted(false);
      setState("ready");
    };
    c.on("disconnect", end);
    c.on("cancel", end);
    c.on("reject", end);
    c.on("error", (e: { message: string }) => {
      setError(e.message);
      end();
    });
  }

  const dial = useCallback(
    async (to: string, contactId?: string) => {
      setVisible(true);
      setNumber(to);
      setPeer(to);
      setError(null);
      if (!to) return;
      if (provider !== "twilio") {
        // Sandbox: simulamos conexión y registramos la llamada al colgar.
        simulated.current = { to, contactId, started: Date.now() };
        setState("ringing");
        setTimeout(() => simulated.current && setState("in-call"), 1200);
        return;
      }
      if (!device.current) return setError("El teléfono no está listo");
      setState("connecting");
      const c = await device.current.connect({ params: { To: to, ...(contactId ? { contactId } : {}) } });
      call.current = c;
      bindCall(c);
    },
    [provider],
  );

  async function hangup() {
    if (simulated.current) {
      const s = simulated.current;
      simulated.current = null;
      setState("ready");
      await api.post("/calls/simulate", {
        to: s.to,
        contactId: s.contactId,
        duration: Math.round((Date.now() - s.started) / 1000),
      });
      window.dispatchEvent(new CustomEvent("nexus:calls-changed"));
      return;
    }
    call.current?.disconnect();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("nexus:calls-changed")), 1500);
  }

  function toggleMute() {
    const next = !muted;
    call.current?.mute(next);
    setMuted(next);
  }

  const press = (d: string) => {
    if (state === "in-call") call.current?.sendDigits(d);
    else setNumber((n) => n + d);
  };

  const busy = state === "connecting" || state === "ringing" || state === "in-call";

  return (
    <Ctx.Provider value={{ state, provider, error, dial: (to, id) => void dial(to, id), open: () => setVisible(true) }}>
      {children}
      {visible && (
        <div className="fixed bottom-4 right-4 z-50 w-72 overflow-hidden rounded-2xl bg-slate-900 text-white shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <span className={clsx("h-2 w-2 rounded-full", state === "offline" ? "bg-rose-500" : "bg-emerald-400")} />
              {provider === "twilio" ? "Twilio Voice" : provider ? "Sandbox (simulado)" : "Sin proveedor de voz"}
            </span>
            {!busy && state !== "incoming" && (
              <button onClick={() => setVisible(false)} aria-label="Cerrar teléfono">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {state === "incoming" ? (
            <div className="px-4 pb-5 text-center">
              <PhoneIncoming className="mx-auto mb-2 h-8 w-8 animate-pulse text-emerald-400" />
              <p className="text-sm text-slate-400">Llamada entrante</p>
              <p className="text-lg font-semibold">{peer}</p>
              <div className="mt-4 flex justify-center gap-4">
                <button onClick={() => call.current?.reject()} className="rounded-full bg-rose-600 p-3 hover:bg-rose-500" aria-label="Rechazar">
                  <PhoneOff className="h-5 w-5" />
                </button>
                <button onClick={() => call.current?.accept()} className="rounded-full bg-emerald-600 p-3 hover:bg-emerald-500" aria-label="Contestar">
                  <Phone className="h-5 w-5" />
                </button>
              </div>
            </div>
          ) : busy ? (
            <div className="px-4 pb-5 text-center">
              <p className="text-sm text-slate-400">
                {state === "in-call" ? duration(seconds) : state === "ringing" ? "Llamando…" : "Conectando…"}
              </p>
              <p className="mt-1 text-lg font-semibold">{peer}</p>
              <Keypad onPress={press} />
              <div className="mt-4 flex justify-center gap-4">
                <button onClick={toggleMute} className="rounded-full bg-slate-700 p-3 hover:bg-slate-600" aria-label="Silenciar">
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <button onClick={() => void hangup()} className="rounded-full bg-rose-600 p-3 hover:bg-rose-500" aria-label="Colgar">
                  <PhoneOff className="h-5 w-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 pb-5">
              <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2">
                <input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="+52 55 1234 5678"
                  className="w-full bg-transparent text-lg outline-none placeholder:text-slate-500"
                />
                <button onClick={() => setNumber((n) => n.slice(0, -1))} aria-label="Borrar">
                  <Delete className="h-4 w-4 text-slate-400" />
                </button>
              </div>
              <Keypad onPress={press} />
              <button
                disabled={!number || state === "offline"}
                onClick={() => void dial(number)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-2.5 font-medium hover:bg-emerald-500 disabled:opacity-40"
              >
                <Phone className="h-4 w-4" /> Llamar
              </button>
              {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
            </div>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

function Keypad({ onPress }: { onPress: (d: string) => void }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
        <button key={d} onClick={() => onPress(d)} className="rounded-lg bg-slate-800 py-2 text-lg hover:bg-slate-700">
          {d}
        </button>
      ))}
    </div>
  );
}
