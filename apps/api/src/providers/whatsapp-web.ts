import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { emitToWorkspace } from "../lib/realtime.js";
import { ProviderError, type ProviderDefinition } from "./types.js";

/**
 * WhatsApp Web: vincula un número escaneando un QR (como WhatsApp Web en el navegador).
 * Usa Baileys (protocolo multi-dispositivo por WebSocket, sin Chromium).
 * Es una dependencia opcional: si no está instalada el proveedor informa del error.
 *
 * Nota: no es una API oficial de Meta. Para alto volumen usa la Cloud API.
 */

type WaSession = {
  sock: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  workspaceId: string;
  status: "connecting" | "qr" | "open" | "closed";
  qr?: string;
  me?: string;
};

export interface WaInbound {
  connectionId: string;
  workspaceId: string;
  from: string;
  body: string;
  providerMessageId?: string;
  profileName?: string;
}

const sessions = new Map<string, WaSession>();
/** Sesiones cerradas a propósito (logout / borrado): no se reconectan. */
const stopping = new Set<string>();
let inboundHandler: ((m: WaInbound) => Promise<void>) | null = null;

export function onWhatsAppWebInbound(handler: (m: WaInbound) => Promise<void>) {
  inboundHandler = handler;
}

async function loadBaileys() {
  try {
    const mod: any = await import("@whiskeysockets/baileys"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const makeWASocket = typeof mod.default === "function" ? mod.default : mod.default?.default ?? mod.makeWASocket;
    return { ...mod, makeWASocket };
  } catch {
    throw new ProviderError(
      "whatsapp_web",
      "La dependencia opcional @whiskeysockets/baileys no está instalada (npm i @whiskeysockets/baileys pino)",
    );
  }
}

const sessionDir = (connectionId: string) => path.resolve(config.waSessionsDir, connectionId);

async function setStatus(connectionId: string, workspaceId: string, s: WaSession["status"], extra: Record<string, unknown> = {}) {
  const dbStatus = s === "open" ? "active" : s === "closed" ? "disconnected" : "pending";
  await prisma.providerConnection
    .update({ where: { id: connectionId }, data: { status: dbStatus, lastError: null } })
    .catch(() => undefined);
  emitToWorkspace(workspaceId, "whatsapp:status", { connectionId, status: s, ...extra });
}

export async function startWhatsAppWeb(connectionId: string, workspaceId: string): Promise<WaSession> {
  const existing = sessions.get(connectionId);
  if (existing && existing.status !== "closed") return existing;

  stopping.delete(connectionId);
  const b = await loadBaileys();
  const pino = (await import("pino")).default;
  const { state, saveCreds } = await b.useMultiFileAuthState(sessionDir(connectionId));
  let version: number[] | undefined;
  try {
    version = (await b.fetchLatestBaileysVersion()).version;
  } catch {
    version = undefined;
  }

  const sock = b.makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    browser: ["CRM NEXUS", "Chrome", "1.0"],
    logger: pino({ level: "silent" }),
    syncFullHistory: false,
  });
  const session: WaSession = { sock, workspaceId, status: "connecting" };
  sessions.set(connectionId, session);

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (u: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (u.qr) {
      session.status = "qr";
      session.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 });
      await setStatus(connectionId, workspaceId, "qr", { qr: session.qr });
    }
    if (u.connection === "open") {
      session.status = "open";
      session.qr = undefined;
      session.me = String(sock.user?.id ?? "").split(":")[0].split("@")[0];
      await prisma.providerConnection
        .update({
          where: { id: connectionId },
          data: { settings: { phone: session.me ? `+${session.me}` : null, name: sock.user?.name ?? null } },
        })
        .catch(() => undefined);
      await setStatus(connectionId, workspaceId, "open", { phone: session.me });
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === b.DisconnectReason?.loggedOut;
      session.status = "closed";
      sessions.delete(connectionId);
      if (stopping.has(connectionId)) return;
      const stillExists = await prisma.providerConnection.findUnique({ where: { id: connectionId } });
      if (!stillExists) return;
      if (loggedOut) {
        await fs.rm(sessionDir(connectionId), { recursive: true, force: true });
        await setStatus(connectionId, workspaceId, "closed", { reason: "logged_out" });
      } else if (state.creds?.registered || code === b.DisconnectReason?.restartRequired) {
        // Reconexión automática de sesiones ya vinculadas (reinicios del servidor, cortes de red...)
        // y el reinicio que WhatsApp exige justo después de escanear el QR.
        setTimeout(() => void startWhatsAppWeb(connectionId, workspaceId).catch(() => undefined), 3000);
      } else {
        // El QR caducó sin escanearse: no generamos QRs indefinidamente.
        await setStatus(connectionId, workspaceId, "closed", { reason: "qr_timeout" });
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (type !== "notify" || !inboundHandler) return;
    for (const m of messages) {
      if (m.key?.fromMe) continue;
      let jid: string = m.key?.remoteJid ?? "";
      if (jid.endsWith("@lid")) jid = m.key?.senderPn ?? m.key?.remoteJidAlt ?? jid;
      if (!jid.endsWith("@s.whatsapp.net")) continue; // ignora grupos, estados, newsletters
      const msg = m.message ?? {};
      const body: string =
        msg.conversation ??
        msg.extendedTextMessage?.text ??
        msg.imageMessage?.caption ??
        msg.videoMessage?.caption ??
        (msg.imageMessage ? "[imagen]" : msg.audioMessage ? "[audio]" : msg.documentMessage ? "[documento]" : "");
      if (!body) continue;
      await inboundHandler({
        connectionId,
        workspaceId,
        from: `+${jid.split("@")[0]}`,
        body,
        providerMessageId: m.key?.id,
        profileName: m.pushName,
      }).catch((e) => console.error("[whatsapp_web] inbound", e));
    }
  });

  return session;
}

export function getWhatsAppWebState(connectionId: string) {
  const s = sessions.get(connectionId);
  return s ? { status: s.status, qr: s.qr, phone: s.me } : { status: "closed" as const };
}

export async function logoutWhatsAppWeb(connectionId: string) {
  stopping.add(connectionId);
  const s = sessions.get(connectionId);
  if (s) {
    await Promise.resolve()
      .then(() => (s.status === "open" ? s.sock.logout() : s.sock.end(undefined)))
      .catch(() => undefined);
    sessions.delete(connectionId);
  }
  await fs.rm(sessionDir(connectionId), { recursive: true, force: true });
}

/** Al arrancar el servidor, reanuda las sesiones que ya estaban vinculadas. */
export async function restoreWhatsAppWebSessions() {
  const conns = await prisma.providerConnection.findMany({ where: { provider: "whatsapp_web", status: "active" } });
  for (const c of conns) {
    const hasCreds = await fs.stat(path.join(sessionDir(c.id), "creds.json")).then(() => true, () => false);
    if (hasCreds) void startWhatsAppWeb(c.id, c.workspaceId).catch((e) => console.error("[whatsapp_web]", e.message));
  }
}

function requireOpen(connectionId: string) {
  const s = sessions.get(connectionId);
  if (!s || s.status !== "open") {
    throw new ProviderError("whatsapp_web", "La sesión de WhatsApp Web no está vinculada. Escanea el QR en el módulo WhatsApp.", true);
  }
  return s;
}

export const whatsappWebProvider: ProviderDefinition = {
  key: "whatsapp_web",
  label: "WhatsApp Web (QR)",
  description: "Vincula cualquier número de WhatsApp escaneando un código QR. Sin aprobación de Meta.",
  channels: ["WHATSAPP"],
  credentialFields: [],
  settingsFields: [],
  create(ctx) {
    return {
      async send(msg) {
        const s = requireOpen(ctx.connectionId);
        const jid = `${msg.to.replace(/\D/g, "")}@s.whatsapp.net`;
        const content = msg.mediaUrl ? { image: { url: msg.mediaUrl }, caption: msg.body } : { text: msg.body };
        const res = await s.sock.sendMessage(jid, content);
        return { providerMessageId: res?.key?.id, status: "SENT" };
      },
      async test() {
        const st = getWhatsAppWebState(ctx.connectionId);
        return st.status === "open"
          ? { ok: true, detail: `Vinculado a +${st.phone}` }
          : { ok: false, detail: `Estado: ${st.status}. Escanea el QR para vincular.` };
      },
      async verifyAddress(_channel, address) {
        const s = requireOpen(ctx.connectionId);
        const [r] = (await s.sock.onWhatsApp(address.replace(/\D/g, ""))) ?? [];
        return { status: r?.exists ? "VALID" : "INVALID", detail: { jid: r?.jid } };
      },
    };
  },
};
