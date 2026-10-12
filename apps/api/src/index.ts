import http from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { setIO } from "./lib/realtime.js";
import { verifyToken } from "./middleware/auth.js";
import { registerAutomationTriggers } from "./automation/triggers.js";
import { startScheduler } from "./services/scheduler.js";
import { recordInbound } from "./services/messaging.js";
import { onWhatsAppWebInbound, restoreWhatsAppWebSessions } from "./providers/whatsapp-web.js";

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: config.webOrigin.split(","), credentials: true } });
io.use((socket, next) => {
  try {
    const { workspaceId, userId } = verifyToken(String(socket.handshake.auth?.token ?? ""));
    socket.data = { workspaceId, userId };
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});
io.on("connection", (socket) => {
  void socket.join(`ws:${socket.data.workspaceId}`);
  void socket.join(`user:${socket.data.userId}`);
});
setIO(io);

registerAutomationTriggers();
onWhatsAppWebInbound((m) =>
  recordInbound({
    workspaceId: m.workspaceId,
    channel: "WHATSAPP",
    from: m.from,
    body: m.body,
    connectionId: m.connectionId,
    provider: "whatsapp_web",
    providerMessageId: m.providerMessageId,
    profileName: m.profileName,
  }).then(() => undefined),
);

server.listen(config.port, async () => {
  console.log(`⚡ CRM NEXUS API en http://localhost:${config.port}`);
  if (!config.disableScheduler) startScheduler();
  await restoreWhatsAppWebSessions().catch((e) => console.error("[whatsapp_web] restore", e));
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
