import type { Channel, ProviderConnection } from "@prisma/client";
import { prisma } from "../db.js";
import { decryptJson } from "../lib/crypto.js";
import { HttpError } from "../lib/errors.js";
import { getProvider } from "../providers/registry.js";
import type { ProviderAdapter } from "../providers/types.js";
import { updateMessageStatusByProviderId } from "./status.js";

const cache = new Map<string, { version: number; adapter: ProviderAdapter }>();

/** Instancia (y cachea) el adaptador de una conexión. */
export function adapterFor(conn: ProviderConnection): ProviderAdapter {
  const version = conn.updatedAt.getTime();
  const hit = cache.get(conn.id);
  if (hit && hit.version === version) return hit.adapter;
  const def = getProvider(conn.provider);
  if (!def) throw new HttpError(500, `Proveedor desconocido: ${conn.provider}`);
  const adapter = def.create({
    connectionId: conn.id,
    workspaceId: conn.workspaceId,
    credentials: decryptJson(conn.credentials),
    settings: (conn.settings ?? {}) as Record<string, unknown>,
    hooks: { statusUpdate: updateMessageStatusByProviderId },
  });
  cache.set(conn.id, { version, adapter });
  return adapter;
}

export function invalidateAdapter(connectionId: string) {
  cache.delete(connectionId);
}

/**
 * Conexiones que entregan un canal, en orden de prioridad (failover).
 * Si no hay rutas explícitas, usa cualquier conexión activa compatible.
 */
export async function connectionsForChannel(workspaceId: string, channel: Channel): Promise<ProviderConnection[]> {
  const routes = await prisma.channelRoute.findMany({
    where: { workspaceId, channel, connection: { status: { not: "disabled" } } },
    include: { connection: true },
    orderBy: { priority: "asc" },
  });
  if (routes.length) return routes.map((r) => r.connection);
  const all = await prisma.providerConnection.findMany({
    where: { workspaceId, status: { in: ["active", "pending"] } },
    orderBy: { createdAt: "asc" },
  });
  return all.filter((c) => getProvider(c.provider)?.channels.includes(channel));
}

export async function voiceConnection(workspaceId: string) {
  const [conn] = await connectionsForChannel(workspaceId, "VOICE");
  if (!conn) throw new HttpError(400, "No hay un proveedor de voz configurado (Ajustes → Proveedores)");
  return conn;
}
