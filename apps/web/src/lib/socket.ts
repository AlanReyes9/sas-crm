import { io, type Socket } from "socket.io-client";
import { useEffect } from "react";
import { apiBase, tokenStore } from "./api";

let socket: Socket | null = null;

/** En hosting serverless (Vercel) no hay WebSockets: la UI refresca por polling. */
export const realtimeEnabled = import.meta.env.VITE_REALTIME !== "off";

export function getSocket(): Socket | null {
  const token = tokenStore.get();
  if (!token || !realtimeEnabled) return null;
  if (!socket) {
    socket = io(apiBase || undefined, { auth: { token }, transports: ["websocket", "polling"] });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Suscribe un componente a un evento de tiempo real del workspace. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.on(event, handler);
    return () => {
      s.off(event, handler);
    };
  }, [event, handler]);
}
