/**
 * Entrada para Vercel (funciones serverless). A diferencia de index.ts no abre
 * Socket.IO ni arranca el scheduler en bucle: el trabajo diferido se ejecuta con
 * waitUntil, Vercel Cron y en cada petición (ver app.ts).
 */
import { createApp } from "./app.js";
import { registerAutomationTriggers } from "./automation/triggers.js";

registerAutomationTriggers();

export default createApp();
