import crypto from "node:crypto";
import { isE164, isEmail } from "../lib/phone.js";
import type { ProviderDefinition } from "./types.js";

/**
 * Proveedor sandbox: no envía nada real. Útil para desarrollo, demos y tests.
 * Simula la confirmación de entrega unos segundos después del envío.
 */
export const mockProvider: ProviderDefinition = {
  key: "mock",
  label: "Sandbox (simulado)",
  description: "Simula envíos en todos los canales sin coste. Ideal para probar flujos y campañas.",
  channels: ["WHATSAPP", "SMS", "EMAIL", "VOICE"],
  credentialFields: [],
  settingsFields: [
    { key: "failRate", label: "Porcentaje de fallos simulados", type: "number", placeholder: "0" },
    { key: "deliveryDelayMs", label: "Retraso de entrega (ms)", type: "number", placeholder: "1500" },
  ],
  create(ctx) {
    const failRate = Number(ctx.settings.failRate ?? 0);
    const delay = Number(ctx.settings.deliveryDelayMs ?? 1500);
    return {
      async send(message) {
        const id = `mock_${crypto.randomUUID()}`;
        const fail = Math.random() * 100 < failRate;
        setTimeout(() => {
          void ctx.hooks
            .statusUpdate(id, fail ? "FAILED" : "DELIVERED", fail ? "Fallo simulado" : undefined)
            .catch(() => undefined);
        }, delay).unref?.();
        return { providerMessageId: id, status: "SENT", raw: { simulated: true, to: message.to } };
      },
      async test() {
        return { ok: true, detail: "Proveedor simulado activo" };
      },
      async verifyAddress(channel, address) {
        const valid = channel === "EMAIL" ? isEmail(address) : isE164(address);
        return { status: valid ? "VALID" : "INVALID", detail: { simulated: true } };
      },
      voice: {
        createAccessToken: () => "mock-token",
        callerId: () => "+15005550006",
      },
    };
  },
};
