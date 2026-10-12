import { Router } from "express";
import type { ProviderConnection } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { badRequest, notFound } from "../lib/errors.js";
import { decryptJson, encryptJson, mask } from "../lib/crypto.js";
import { requireRole } from "../middleware/auth.js";
import { getProvider, listProviders } from "../providers/registry.js";
import { logoutWhatsAppWeb } from "../providers/whatsapp-web.js";
import { adapterFor, invalidateAdapter } from "../services/connections.js";

export const connectionsRouter = Router();
const channelEnum = z.enum(["WHATSAPP", "SMS", "EMAIL", "VOICE"]);

/** Nunca devolvemos secretos: solo los últimos 4 caracteres. */
function present(conn: ProviderConnection) {
  const def = getProvider(conn.provider);
  const creds = decryptJson(conn.credentials);
  const masked = Object.fromEntries(
    (def?.credentialFields ?? []).map((f) => [f.key, f.type === "password" ? mask(creds[f.key]) : creds[f.key] ?? ""]),
  );
  return {
    id: conn.id,
    provider: conn.provider,
    providerLabel: def?.label ?? conn.provider,
    name: conn.name,
    status: conn.status,
    lastError: conn.lastError,
    channels: def?.channels ?? [],
    settings: conn.settings,
    credentials: masked,
    webhooks: (def?.webhooks?.(conn.id) ?? []).map((w) => ({ ...w, url: `${config.publicUrl}${w.path}` })),
    createdAt: conn.createdAt,
  };
}

connectionsRouter.get("/providers", (_req, res) => {
  res.json(
    listProviders().map(({ create: _c, webhooks: _w, ...def }) => def),
  );
});

connectionsRouter.get(
  "/",
  ah(async (req, res) => {
    const conns = await prisma.providerConnection.findMany({
      where: { workspaceId: req.auth.workspaceId },
      orderBy: { createdAt: "asc" },
    });
    res.json(conns.map(present));
  }),
);

const createInput = z.object({
  provider: z.string(),
  name: z.string().min(1),
  credentials: z.record(z.string()).default({}),
  settings: z.record(z.unknown()).default({}),
});

connectionsRouter.post(
  "/",
  requireRole("OWNER", "ADMIN"),
  ah(async (req, res) => {
    const body = createInput.parse(req.body);
    const def = getProvider(body.provider);
    if (!def) throw badRequest("Proveedor desconocido");
    for (const f of [...def.credentialFields, ...def.settingsFields]) {
      const v = f.key in body.credentials ? body.credentials[f.key] : body.settings[f.key];
      if (f.required && (v === undefined || v === "")) throw badRequest(`Falta el campo "${f.label}"`);
    }
    const conn = await prisma.providerConnection.create({
      data: {
        workspaceId: req.auth.workspaceId,
        provider: body.provider,
        name: body.name,
        credentials: encryptJson(body.credentials),
        settings: body.settings as object,
        status: body.provider === "whatsapp_web" ? "pending" : "active",
      },
    });
    res.status(201).json(present(conn));
  }),
);

connectionsRouter.patch(
  "/:id",
  requireRole("OWNER", "ADMIN"),
  ah(async (req, res) => {
    const body = createInput.partial().omit({ provider: true }).extend({ status: z.enum(["active", "disabled"]).optional() }).parse(req.body);
    const conn = await prisma.providerConnection.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!conn) throw notFound("Conexión");
    // Los secretos enmascarados (••••) que vuelven del formulario se ignoran.
    let credentials = conn.credentials;
    if (body.credentials) {
      const current = decryptJson(conn.credentials);
      for (const [k, v] of Object.entries(body.credentials)) if (!v.startsWith("••••")) current[k] = v;
      credentials = encryptJson(current);
    }
    const updated = await prisma.providerConnection.update({
      where: { id: conn.id },
      data: {
        name: body.name,
        status: body.status,
        credentials,
        settings: body.settings ? ({ ...(conn.settings as object), ...body.settings } as object) : undefined,
      },
    });
    invalidateAdapter(conn.id);
    res.json(present(updated));
  }),
);

connectionsRouter.delete(
  "/:id",
  requireRole("OWNER", "ADMIN"),
  ah(async (req, res) => {
    const conn = await prisma.providerConnection.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!conn) throw notFound("Conexión");
    if (conn.provider === "whatsapp_web") await logoutWhatsAppWeb(conn.id);
    await prisma.providerConnection.delete({ where: { id: conn.id } });
    invalidateAdapter(conn.id);
    res.status(204).end();
  }),
);

connectionsRouter.post(
  "/:id/test",
  ah(async (req, res) => {
    const conn = await prisma.providerConnection.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!conn) throw notFound("Conexión");
    const result = await adapterFor(conn).test();
    if (conn.provider !== "whatsapp_web") {
      await prisma.providerConnection.update({
        where: { id: conn.id },
        data: { lastError: result.ok ? null : result.detail, status: result.ok ? "active" : "error" },
      });
    }
    res.json(result);
  }),
);

// ── Enrutamiento por canal ──

connectionsRouter.get(
  "/routing/all",
  ah(async (req, res) => {
    const routes = await prisma.channelRoute.findMany({
      where: { workspaceId: req.auth.workspaceId },
      orderBy: [{ channel: "asc" }, { priority: "asc" }],
    });
    res.json(routes);
  }),
);

/** Reemplaza el orden de proveedores de un canal: [connA (principal), connB (failover)...] */
connectionsRouter.put(
  "/routing/:channel",
  requireRole("OWNER", "ADMIN"),
  ah(async (req, res) => {
    const channel = channelEnum.parse(req.params.channel);
    const { connectionIds } = z.object({ connectionIds: z.array(z.string()) }).parse(req.body);
    const { workspaceId } = req.auth;
    const conns = await prisma.providerConnection.findMany({ where: { workspaceId, id: { in: connectionIds } } });
    for (const c of conns) {
      if (!getProvider(c.provider)?.channels.includes(channel)) {
        throw badRequest(`${c.name} (${c.provider}) no soporta el canal ${channel}`);
      }
    }
    await prisma.$transaction([
      prisma.channelRoute.deleteMany({ where: { workspaceId, channel } }),
      prisma.channelRoute.createMany({
        data: connectionIds
          .filter((id) => conns.some((c) => c.id === id))
          .map((connectionId, priority) => ({ workspaceId, channel, connectionId, priority })),
      }),
    ]);
    res.json(await prisma.channelRoute.findMany({ where: { workspaceId, channel }, orderBy: { priority: "asc" } }));
  }),
);
