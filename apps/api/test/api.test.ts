import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db.js";
import { registerAutomationTriggers } from "../src/automation/triggers.js";
import { processCampaignBatch } from "../src/services/campaigns.js";
import { app, resetDb, signup } from "./helpers.js";

registerAutomationTriggers();
const flush = () => new Promise((r) => setTimeout(r, 150));

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("auth y multi-tenant", () => {
  it("registra, inicia sesión y aísla workspaces", async () => {
    const a = await signup("Empresa A");
    const b = await signup("Empresa B");
    const created = await a.api.post("/api/contacts", { firstName: "Luis", phone: "5512345678" });
    expect(created.status).toBe(201);
    expect(created.body.phone).toBe("+525512345678");
    expect((await b.api.get(`/api/contacts/${created.body.id}`)).status).toBe(404);
    expect((await request(app).get("/api/contacts")).status).toBe(401);
  });
});

describe("contactos, etiquetas y segmentos", () => {
  it("importa, etiqueta y segmenta", async () => {
    const { api } = await signup();
    const imp = await api.post("/api/contacts/import", {
      rows: [
        { firstName: "Ana", phone: "+5215511111111", email: "ana@example.com", company: "Acme" },
        { firstName: "Beto", phone: "+5215522222222" },
        { firstName: "Ana bis", phone: "+5215511111111" }, // duplicado → update
        { firstName: "SinDatos" },
      ],
      tags: ["lead"],
    });
    expect(imp.body).toMatchObject({ created: 2, updated: 1 });
    expect(imp.body.errors).toHaveLength(1);

    const seg = await api.post("/api/segments", {
      name: "Leads con email",
      rules: { match: "all", conditions: [{ field: "tag", op: "has", value: "lead" }, { field: "hasChannel", op: "has", value: "EMAIL" }] },
    });
    expect(seg.status).toBe(201);
    const list = await api.get(`/api/contacts?segmentId=${seg.body.id}`);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].email).toBe("ana@example.com");
  });

  it("verifica canales con el proveedor configurado", async () => {
    const { api } = await signup();
    const c = await api.post("/api/contacts", { firstName: "Eva", phone: "+5215533333333", email: "eva@@mal" }).expect(400);
    expect(c.body.error).toBe("Datos inválidos");
    const ok = await api.post("/api/contacts", { firstName: "Eva", phone: "+5215533333333" });
    const v = await api.post(`/api/contacts/${ok.body.id}/verify`, { channels: ["WHATSAPP", "SMS"] });
    expect(v.body.map((r: { status: string }) => r.status)).toEqual(["VALID", "VALID"]);
  });
});

describe("mensajería multi-proveedor", () => {
  it("envía por el sandbox y recibe entrantes en la bandeja", async () => {
    const { api } = await signup();
    const c = await api.post("/api/contacts", { firstName: "Ana", phone: "+5215511111111" });
    const sent = await api.post("/api/conversations/start", { contactId: c.body.id, channel: "WHATSAPP", body: "Hola {{contact.firstName}}" });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ body: "Hola Ana", status: "SENT", provider: "mock" });

    await api.post("/api/dev/simulate-inbound", { channel: "WHATSAPP", from: "+5215511111111", body: "Gracias!" }).expect(201);
    const convs = await api.get("/api/conversations");
    expect(convs.body).toHaveLength(1);
    expect(convs.body[0].unreadCount).toBe(1);
    const detail = await api.get(`/api/conversations/${convs.body[0].id}`);
    expect(detail.body.messages.map((m: { direction: string }) => m.direction)).toEqual(["OUTBOUND", "INBOUND"]);
  });

  it("hace failover al siguiente proveedor y respeta el enrutamiento", async () => {
    const { api } = await signup();
    // Conexión WhatsApp Web sin vincular (fallará) como principal, sandbox como respaldo.
    const wa = await api.post("/api/connections", { provider: "whatsapp_web", name: "WA Web" });
    const conns = await api.get("/api/connections");
    const mock = conns.body.find((c: { provider: string }) => c.provider === "mock");
    await api.put("/api/connections/routing/WHATSAPP", { connectionIds: [wa.body.id, mock.id] }).expect(200);
    const c = await api.post("/api/contacts", { firstName: "Ana", phone: "+5215511111111" });
    const sent = await api.post("/api/conversations/start", { contactId: c.body.id, channel: "WHATSAPP", body: "Hola" });
    expect(sent.body.status).toBe("SENT");
    expect(sent.body.provider).toBe("mock");
    expect(sent.body.error).toMatch(/Failover/);

    // Un proveedor solo-email no puede enrutar WhatsApp
    const smtp = await api.post("/api/connections", {
      provider: "smtp",
      name: "SMTP",
      credentials: { host: "smtp.example.com", port: "587" },
      settings: { fromEmail: "hola@acme.test" },
    });
    await api.put("/api/connections/routing/WHATSAPP", { connectionIds: [smtp.body.id] }).expect(400);
  });

  it("nunca expone secretos de proveedores", async () => {
    const { api } = await signup();
    await api.post("/api/connections", {
      provider: "twilio",
      name: "Twilio",
      credentials: { accountSid: "AC123", authToken: "supersecrettoken" },
      settings: { smsFrom: "+15550001111" },
    });
    const list = await api.get("/api/connections");
    const tw = list.body.find((c: { provider: string }) => c.provider === "twilio");
    expect(tw.credentials.authToken).toBe("••••oken");
    expect(JSON.stringify(list.body)).not.toContain("supersecrettoken");
    expect(tw.webhooks.length).toBeGreaterThan(0);
  });

  it("registra opt-out con la palabra STOP", async () => {
    const { api } = await signup();
    await api.post("/api/dev/simulate-inbound", { channel: "SMS", from: "+5215599999999", body: "STOP" });
    const list = await api.get("/api/contacts");
    expect(list.body.items[0].optOut).toBe(true);
  });
});

describe("campañas", () => {
  it("resuelve audiencia, omite opt-out y envía", async () => {
    const { api, workspaceId } = await signup();
    const tpl = await api.post("/api/templates", { name: "Promo", channel: "SMS", body: "Hola {{contact.firstName}}, 20% hoy" });
    await api.post("/api/contacts", { firstName: "A", phone: "+5215500000001", tags: ["vip"] });
    await api.post("/api/contacts", { firstName: "B", phone: "+5215500000002", tags: ["vip"], optOut: true });
    await api.post("/api/contacts", { firstName: "C", email: "c@x.com", tags: ["vip"] });
    const tags = await api.get("/api/tags");
    const vip = tags.body.find((t: { name: string }) => t.name === "vip");

    const camp = await api.post("/api/campaigns", {
      name: "Black Friday",
      channel: "SMS",
      templateId: tpl.body.id,
      audience: { tagIds: [vip.id] },
    });
    expect(camp.status).toBe(201);
    const launched = await api.post(`/api/campaigns/${camp.body.id}/launch`);
    expect(launched.body.status).toBe("RUNNING");

    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: camp.body.id } });
    expect(c.workspaceId).toBe(workspaceId);
    await processCampaignBatch(c, 60);
    await processCampaignBatch(c, 60); // segunda pasada → COMPLETED

    const detail = await api.get(`/api/campaigns/${camp.body.id}`);
    expect(detail.body.status).toBe("COMPLETED");
    expect(detail.body.stats).toMatchObject({ total: 3, SENT: 1, SKIPPED: 2 });
    const sentRecipient = detail.body.recipients.find((r: { status: string }) => r.status === "SENT");
    const msg = await prisma.message.findUniqueOrThrow({ where: { id: sentRecipient.messageId } });
    expect(msg.body).toBe("Hola A, 20% hoy");
  });
});

describe("automatizaciones", () => {
  const graph = {
    nodes: [
      { id: "t", type: "trigger", data: { triggerType: "message_received", channel: "ANY" } },
      { id: "c", type: "condition", data: { match: "any", conditions: [{ left: "{{message.body}}", op: "contains", right: "precio,costo" }] } },
      { id: "tag", type: "add_tag", data: { tagName: "interesado" } },
      { id: "reply", type: "send_message", data: { channel: "same", body: "Hola {{contact.firstName}}, te enviamos precios." } },
      { id: "end", type: "end", data: {} },
    ],
    edges: [
      { id: "1", source: "t", target: "c" },
      { id: "2", source: "c", target: "tag", sourceHandle: "true" },
      { id: "3", source: "tag", target: "reply" },
      { id: "4", source: "c", target: "end", sourceHandle: "false" },
    ],
  };

  it("se dispara con mensajes entrantes y sigue la rama correcta", async () => {
    const { api } = await signup();
    const wf = await api.post("/api/workflows", { name: "Precios", graph, active: true });
    expect(wf.status).toBe(201);
    expect(wf.body.triggerType).toBe("message_received");

    await api.post("/api/dev/simulate-inbound", { channel: "WHATSAPP", from: "+5215512340000", body: "¿Cuál es el precio?", profileName: "Marta Ruiz" });
    await flush();
    const runs = await api.get(`/api/workflows/${wf.body.id}/runs`);
    expect(runs.body[0].status).toBe("COMPLETED");

    const contacts = await api.get("/api/contacts");
    const marta = contacts.body.items[0];
    expect(marta.firstName).toBe("Marta");
    expect(marta.tags.map((t: { tag: { name: string } }) => t.tag.name)).toContain("interesado");
    const conv = await api.get("/api/conversations");
    const detail = await api.get(`/api/conversations/${conv.body[0].id}`);
    expect(detail.body.messages.at(-1).body).toBe("Hola Marta, te enviamos precios.");

    await api.post("/api/dev/simulate-inbound", { channel: "WHATSAPP", from: "+5215512340000", body: "ok gracias" });
    await flush();
    const runs2 = await api.get(`/api/workflows/${wf.body.id}/runs`);
    expect(runs2.body).toHaveLength(2);
    expect(runs2.body[0].logs.map((l: { type: string }) => l.type)).toEqual(["condition", "end"]);
  });

  it("pausa en nodos de espera y reanuda", async () => {
    const { api } = await signup();
    const c = await api.post("/api/contacts", { firstName: "Ana", phone: "+5215511111111" });
    const wf = await api.post("/api/workflows", {
      name: "Seguimiento",
      graph: {
        nodes: [
          { id: "t", type: "trigger", data: { triggerType: "manual" } },
          { id: "w", type: "wait", data: { amount: 1, unit: "seconds" } },
          { id: "s", type: "send_message", data: { channel: "SMS", body: "¿Sigues interesada?" } },
        ],
        edges: [
          { id: "1", source: "t", target: "w" },
          { id: "2", source: "w", target: "s" },
        ],
      },
    });
    const run = await api.post(`/api/workflows/${wf.body.id}/run`, { contactId: c.body.id });
    expect(run.body.status).toBe("WAITING");
    await new Promise((r) => setTimeout(r, 1100));
    const { resumeDueRuns } = await import("../src/automation/engine.js");
    await resumeDueRuns();
    const runs = await api.get(`/api/workflows/${wf.body.id}/runs`);
    expect(runs.body[0].status).toBe("COMPLETED");
  });

  it("acepta disparadores webhook externos y crea el contacto", async () => {
    const { api } = await signup();
    const wf = await api.post("/api/workflows", {
      name: "Lead de formulario",
      active: true,
      graph: {
        nodes: [
          { id: "t", type: "trigger", data: { triggerType: "webhook" } },
          { id: "u", type: "update_contact", data: { field: "custom.origen", value: "{{vars.payload.source}}" } },
        ],
        edges: [{ id: "1", source: "t", target: "u" }],
      },
    });
    const hook = await request(app)
      .post(`/hooks/${wf.body.webhookKey}`)
      .send({ phone: "+5215577777777", name: "Pedro Paramo", source: "landing" });
    expect(hook.status).toBe(202);
    expect(hook.body.status).toBe("COMPLETED");
    const contacts = await api.get("/api/contacts");
    expect(contacts.body.items[0].customFields).toEqual({ origen: "landing" });
  });

  it("no permite activar flujos inválidos", async () => {
    const { api } = await signup();
    const res = await api.post("/api/workflows", { name: "Roto", active: true, graph: { nodes: [], edges: [] } });
    expect(res.status).toBe(400);
  });
});

describe("webhooks de proveedores", () => {
  it("Twilio: SMS entrante y actualización de estado", async () => {
    const { api } = await signup();
    const tw = await api.post("/api/connections", {
      provider: "twilio",
      name: "Twilio",
      credentials: { accountSid: "AC123", authToken: "tok" },
      settings: { smsFrom: "+15550001111" },
    });
    const r = await request(app)
      .post(`/webhooks/twilio/${tw.body.id}/inbound`)
      .type("form")
      .send({ From: "+5215588888888", To: "+15550001111", Body: "Hola desde SMS", MessageSid: "SM1" });
    expect(r.status).toBe(200);
    expect(r.text).toContain("<Response");
    // reintento del webhook → no duplica
    await request(app)
      .post(`/webhooks/twilio/${tw.body.id}/inbound`)
      .type("form")
      .send({ From: "+5215588888888", To: "+15550001111", Body: "Hola desde SMS", MessageSid: "SM1" });
    const convs = await api.get("/api/conversations");
    expect(convs.body[0].channel).toBe("SMS");
    expect(convs.body[0].unreadCount).toBe(1);
  });

  it("Meta: verificación del webhook y mensaje entrante", async () => {
    const { api } = await signup();
    const meta = await api.post("/api/connections", {
      provider: "meta_whatsapp",
      name: "Meta",
      credentials: { accessToken: "x", verifyToken: "mi-token" },
      settings: { phoneNumberId: "123" },
    });
    const v = await request(app).get(
      `/webhooks/meta/${meta.body.id}?hub.mode=subscribe&hub.verify_token=mi-token&hub.challenge=42`,
    );
    expect(v.text).toBe("42");
    await request(app)
      .post(`/webhooks/meta/${meta.body.id}`)
      .send({
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ wa_id: "5215566666666", profile: { name: "Lucía" } }],
                  messages: [{ id: "wamid.1", from: "5215566666666", type: "text", text: { body: "Hola!" } }],
                },
              },
            ],
          },
        ],
      })
      .expect(200);
    const contacts = await api.get("/api/contacts");
    expect(contacts.body.items[0]).toMatchObject({ firstName: "Lucía", phone: "+5215566666666" });
  });

  it("Twilio Voice: TwiML para llamadas desde el navegador", async () => {
    const { api } = await signup();
    const tw = await api.post("/api/connections", {
      provider: "twilio",
      name: "Twilio",
      credentials: { accountSid: "AC123", authToken: "tok" },
      settings: { voiceCallerId: "+15550001111" },
    });
    const r = await request(app)
      .post(`/webhooks/twilio/${tw.body.id}/voice`)
      .type("form")
      .send({ From: "client:u_x", To: "+5215512345678", CallSid: "CA1" });
    expect(r.text).toContain('<Dial callerId="+15550001111"');
    expect(r.text).toContain("<Number>+5215512345678</Number>");
    const done = await request(app)
      .post(`/webhooks/twilio/${tw.body.id}/voice-complete`)
      .type("form")
      .send({ CallSid: "CA1", DialCallStatus: "completed", DialCallDuration: "37" });
    expect(done.status).toBe(200);
    const calls = await api.get("/api/calls");
    expect(calls.body[0]).toMatchObject({ status: "COMPLETED", duration: 37, direction: "OUTBOUND" });
  });
});
