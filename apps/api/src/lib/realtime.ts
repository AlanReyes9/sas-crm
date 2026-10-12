import type { Server } from "socket.io";

let io: Server | null = null;

export function setIO(server: Server) {
  io = server;
}

/** Emite un evento a todos los usuarios conectados de un workspace. */
export function emitToWorkspace(workspaceId: string, event: string, payload: unknown) {
  io?.to(`ws:${workspaceId}`).emit(event, payload);
}
