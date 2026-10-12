import { Router, type Request } from "express";
import type { CallStatus, ProviderConnection } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { ah } from "../lib/async.js";
import { HttpError } from "../lib/errors.js";
import { decryptJson } from "../lib/crypto.js";
import { emitToWorkspace } from "../lib/realtime.js";
import { toE164 } from "../lib/phone.js";
import { mapTwilioStatus, validateTwilioSignature, VoiceResponse } from "../providers/twilio.js";
import { mapMetaStatus, verifyMetaSignature } from "../providers/meta-whatsapp.js";
import { bus } from "../services/events.js";
import { findOrCreateContact, recordInbound } from "../services/messaging.js";
import { updateMessageStatusByProviderId } from "../services/status.js";
import { buildContext, startRun } from "../automation/engine.js";
import { agentIdentity } from "./calls.js";

/** Webhooks públicos de los proveedores (sin JWT; se validan con la firma de cada proveedor). */
export const webhooksRouter = Router();

async function connection(id: string, provider: string) {
  const conn = await prisma.providerConnection.findFirst({ where: { id, provider } });
  if (!conn) throw new HttpError(404, "Conexión no encontrada");
  return conn;
}

function assertTwilio(req: Request, conn: ProviderConnection) {
  const signature = req.header("x-twilio-signature");
  const strict = process.env.NODE_ENV === "production";
  if (!signature && !strict) return;
  const { authToken } = decryptJson(conn.credentials);
  const url = `${config.publicUrl}${req.originalUrl}`;
  if (!signature || !validateTwilioSignature(authToken, signature, url, req.body ?? {})) {
    throw new HttpError(403, "Firma de Twilio inválida");
  }
}

// ───────────── Twilio: mensajes ─────────────

webhooksRouter.post(
  "/twilio/:id/inbound",
  ah(async (req, res) => {
    const conn = await connection(req.params.id, "twilio");
    assertTwilio(req, conn);
    const b = req.body as Record<string, string>;
    const isWa = String(b.From ?? "").startsWith("whatsapp:");
    await recordInbound({
      workspaceId: conn.workspaceId,
      channel: isWa ? "WHATSAPP" : "SMS",
      from: b.From.replace(/^whatsapp:/, ""),
      body: b.Body ?? "",
      mediaUrl: Number(b.NumMedia ?? 0) > 0 ? b.MediaUrl0 : undefined,
      connectionId: conn.id,
      provider: "twilio",
      providerMessageId: b.MessageSid,
      profileName: b.ProfileName,
    });
    res.type("text/xml").send("<Response/>");
  }),
);

webhooksRouter.post(
  "/twilio/:id/status",
  ah(async (req, res) => {
    const conn = await connection(req.params.id, "twilio");
    assertTwilio(req, conn);
    const b = req.body as Record<string, string>;
    if (b.MessageSid && b.MessageStatus) {
      await updateMessageStatusByProviderId(
        b.MessageSid,
        mapTwilioStatus(b.MessageStatus),
        b.ErrorCode ? `Twilio ${b.ErrorCode}${b.ErrorMessage ? `: ${b.ErrorMessage}` : ""}` : undefined,
      );
    }
    res.sendStatus(204);
  }),
);

// ───────────── Twilio: voz ─────────────

/**
 * Voice URL. Dos casos:
 *  - Llamada saliente desde el navegador: From = client:u_<userId>, To = número destino.
 *  - Llamada entrante a nuestro número: se hace ring a todos los agentes del workspace.
 */
webhooksRouter.post(
  "/twilio/:id/voice",
  ah(async (req, res) => {
    const conn = await connection(req.params.id, "twilio");
    assertTwilio(req, conn);
    const b = req.body as Record<string, string>;
    const settings = conn.settings as Record<string, string | boolean | undefined>;
    const twiml = new VoiceResponse();
    const base = `${config.publicUrl}/webhooks/twilio/${conn.id}`;
    const record = settings.recordCalls ? ("record-from-answer-dual" as const) : undefined;

    if (String(b.From ?? "").startsWith("client:")) {
      const userId = b.From.replace("client:u_", "");
      const to = toE164(b.To) ?? b.To;
      const { contact } = await findOrCreateContact(conn.workspaceId, "VOICE", to);
      const contactId = b.contactId || contact.id;
      await prisma.call.upsert({
        where: { providerSid: b.CallSid },
        create: {
          workspaceId: conn.workspaceId,
          direction: "OUTBOUND",
          from: String(settings.voiceCallerId ?? ""),
          to,
          status: "RINGING",
          providerSid: b.CallSid,
          userId: (await prisma.user.findUnique({ where: { id: userId } })) ? userId : null,
          contactId,
        },
        update: {},
      });
      const dial = twiml.dial({
        callerId: String(settings.voiceCallerId ?? settings.smsFrom ?? ""),
        action: `${base}/voice-complete`,
        record,
        recordingStatusCallback: record ? `${base}/voice-recording` : undefined,
      });
      dial.number(to);
    } else {
      const from = toE164(b.From) ?? b.From;
      const { contact } = await findOrCreateContact(conn.workspaceId, "VOICE", from);
      const call = await prisma.call.upsert({
        where: { providerSid: b.CallSid },
        create: {
          workspaceId: conn.workspaceId,
          direction: "INBOUND",
          from,
          to: b.To,
          status: "RINGING",
          providerSid: b.CallSid,
          contactId: contact.id,
        },
        update: {},
      });
      emitToWorkspace(conn.workspaceId, "call:incoming", { call, contact });
      const members = await prisma.membership.findMany({ where: { workspaceId: conn.workspaceId } });
      const dial = twiml.dial({
        timeout: 25,
        action: `${base}/voice-complete`,
        record,
        recordingStatusCallback: record ? `${base}/voice-recording` : undefined,
      });
      for (const m of members) dial.client(agentIdentity(m.userId));
    }
    res.type("text/xml").send(twiml.toString());
  }),
);

const dialStatus: Record<string, CallStatus> = {
  completed: "COMPLETED",
  answered: "COMPLETED",
  busy: "BUSY",
  "no-answer": "NO_ANSWER",
  failed: "FAILED",
  canceled: "CANCELED",
};

webhooksRouter.post(
  "/twilio/:id/voice-complete",
  ah(async (req, res) => {
    const conn = await connection(req.params.id, "twilio");
    assertTwilio(req, conn);
    const b = req.body as Record<string, string>;
    const status = dialStatus[b.DialCallStatus] ?? "COMPLETED";
    const call = await prisma.call.update({
      where: { providerSid: b.CallSid },
      data: { status, duration: Number(b.DialCallDuration ?? 0), endedAt: new Date() },
      include: { contact: true },
    });
    emitToWorkspace(conn.workspaceId, "call:update", call);
    bus.emitEvent("call.completed", { workspaceId: conn.workspaceId, call, contact: call.contact });

    const twiml = new VoiceResponse();
    if (call.direction === "INBOUND" && status !== "COMPLETED") {
      twiml.say({ language: "es-MX" }, "En este momento no podemos atenderte. Deja tu mensaje después del tono.");
      twiml.record({ maxLength: 120, recordingStatusCallback: `${config.publicUrl}/webhooks/twilio/${conn.id}/voice-recording` });
    }
    twiml.hangup();
    res.type("text/xml").send(twiml.toString());
  }),
);

webhooksRouter.post(
  "/twilio/:id/voice-recording",
  ah(async (req, res) => {
    const conn = await connection(req.params.id, "twilio");
    assertTwilio(req, conn);
    const b = req.body as Record<string, string>;
    if (b.CallSid && b.RecordingUrl) {
      await prisma.call.updateMany({ where: { providerSid: b.CallSid }, data: { recordingUrl: `${b.RecordingUrl}.mp3` } });
    }
    res.sendStatus(204);
  }),
);

// ───────────── Meta WhatsApp Cloud API ─────────────

webhooksRouter.get(
  "/meta/:id",
  ah(async (req, res) => {
    const conn = await connection(req.params.id, "meta_whatsapp");
    const { verifyToken } = decryptJson(conn.credentials);
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
      res.send(String(req.query["hub.challenge"]));
    } else res.sendStatus(403);
  }),
);

webhooksRouter.post(
  "/meta/:id",
  ah(async (req, res) => {
    const conn = await connection(req.params.id, "meta_whatsapp");
    const { appSecret } = decryptJson(conn.credentials);
    if (appSecret) {
      const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
      if (!verifyMetaSignature(appSecret, raw, req.header("x-hub-signature-256"))) {
        throw new HttpError(403, "Firma de Meta inválida");
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const entry of (req.body?.entry ?? []) as any[]) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        const names = Object.fromEntries((v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name])); // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const m of v.messages ?? []) {
          const body =
            m.text?.body ??
            m.button?.text ??
            m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title ??
            m.image?.caption ??
            `[${m.type}]`;
          await recordInbound({
            workspaceId: conn.workspaceId,
            channel: "WHATSAPP",
            from: `+${m.from}`,
            body,
            connectionId: conn.id,
            provider: "meta_whatsapp",
            providerMessageId: m.id,
            profileName: names[m.from],
          });
        }
        for (const s of v.statuses ?? []) {
          await updateMessageStatusByProviderId(s.id, mapMetaStatus(s.status), s.errors?.[0]?.title);
        }
      }
    }
    res.sendStatus(200);
  }),
);

// ───────────── Correo entrante (Mailgun routes / SendGrid parse en JSON / genérico) ─────────────

webhooksRouter.post(
  "/email/:id/inbound",
  ah(async (req, res) => {
    const conn = await prisma.providerConnection.findUnique({ where: { id: req.params.id } });
    if (!conn) throw new HttpError(404, "Conexión no encontrada");
    const b = req.body as Record<string, string>;
    const fromRaw = b.sender ?? b.from ?? b.From ?? "";
    const from = fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw;
    const name = fromRaw.includes("<") ? fromRaw.split("<")[0].replace(/"/g, "").trim() : undefined;
    await recordInbound({
      workspaceId: conn.workspaceId,
      channel: "EMAIL",
      from,
      subject: b.subject ?? b.Subject,
      body: b["stripped-text"] ?? b["body-plain"] ?? b.text ?? b.TextBody ?? "",
      connectionId: conn.id,
      provider: conn.provider,
      providerMessageId: b["Message-Id"] ?? b.MessageID,
      profileName: name,
    });
    res.sendStatus(200);
  }),
);

// ───────────── Disparador "webhook" de automatizaciones ─────────────

export const hooksRouter = Router();

hooksRouter.all(
  "/:key",
  ah(async (req, res) => {
    const wf = await prisma.workflow.findUnique({ where: { webhookKey: req.params.key } });
    if (!wf || !wf.active || wf.triggerType !== "webhook") throw new HttpError(404, "Webhook no encontrado o inactivo");
    const payload = { ...(req.query as object), ...(typeof req.body === "object" ? req.body : {}) } as Record<string, string>;
    let contact = null;
    const phone = payload.phone ?? payload.telefono ?? payload.whatsapp;
    const email = payload.email ?? payload.correo;
    if (phone || email) {
      const r = await findOrCreateContact(
        wf.workspaceId,
        phone ? "WHATSAPP" : "EMAIL",
        phone ?? email,
        payload.name ?? payload.nombre,
      );
      contact = r.contact;
      if (email && !contact.email) contact = await prisma.contact.update({ where: { id: contact.id }, data: { email } });
    }
    const run = await startRun(wf, buildContext(wf.workspaceId, { type: "webhook", payload }, contact, { vars: { payload } }));
    res.status(202).json({ runId: run.id, status: run.status });
  }),
);
