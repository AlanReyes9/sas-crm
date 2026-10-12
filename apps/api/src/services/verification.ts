import type { Channel, VerificationStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { isE164 } from "../lib/phone.js";
import { verifyEmailAddress } from "../providers/email.js";
import type { VerifyResult } from "../providers/types.js";
import { adapterFor, connectionsForChannel } from "./connections.js";
import { addressFor } from "./messaging.js";

/**
 * Verifica los canales de un contacto usando el proveedor configurado
 * (Twilio Lookup para teléfonos, WhatsApp Web onWhatsApp, MX para correos).
 */
export async function verifyContactChannels(workspaceId: string, contactId: string, channels?: Channel[]) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId } });
  if (!contact) throw new HttpError(404, "Contacto no encontrado");
  const targets = channels ?? (["WHATSAPP", "SMS", "EMAIL", "VOICE"] as Channel[]);
  const results: { channel: Channel; address: string; status: VerificationStatus; detail?: unknown }[] = [];

  for (const channel of targets) {
    const address = addressFor(contact, channel);
    if (!address) continue;
    let result: VerifyResult = { status: "UNKNOWN" };
    if (channel !== "EMAIL" && !isE164(address)) {
      result = { status: "INVALID", detail: { reason: "No está en formato E.164" } };
    } else {
      const conns = await connectionsForChannel(workspaceId, channel);
      for (const c of conns) {
        try {
          const adapter = adapterFor(c);
          if (!adapter.verifyAddress) continue;
          result = await adapter.verifyAddress(channel, address);
          result.detail = { ...result.detail, provider: c.provider };
          if (result.status !== "UNKNOWN") break;
        } catch (e) {
          result = { status: "UNKNOWN", detail: { error: (e as Error).message, provider: c.provider } };
        }
      }
      if (result.status === "UNKNOWN" && channel === "EMAIL") result = await verifyEmailAddress(address);
    }
    await prisma.channelVerification.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: { contactId, channel, address, status: result.status, detail: (result.detail ?? {}) as object },
      update: { address, status: result.status, detail: (result.detail ?? {}) as object, checkedAt: new Date() },
    });
    results.push({ channel, address, status: result.status, detail: result.detail });
  }
  return results;
}
