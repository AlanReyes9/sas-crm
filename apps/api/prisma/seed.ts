/**
 * Datos de demostración: workspace "Nexus Demo" con contactos, plantillas,
 * conversaciones, una campaña y automatizaciones de ejemplo.
 * Usuario: demo@nexus.dev / nexus1234
 */
import bcrypt from "bcryptjs";
import { PrismaClient, type Contact } from "@prisma/client";
import { encryptJson } from "../src/lib/crypto.js";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@nexus.dev";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("El seed ya existe (demo@nexus.dev). Nada que hacer.");
    return;
  }
  const user = await prisma.user.create({
    data: { email, name: "Demo Nexus", passwordHash: await bcrypt.hash("nexus1234", 10) },
  });
  const ws = await prisma.workspace.create({ data: { name: "Nexus Demo", slug: "nexus-demo" } });
  await prisma.membership.create({ data: { userId: user.id, workspaceId: ws.id, role: "OWNER" } });

  const sandbox = await prisma.providerConnection.create({
    data: { workspaceId: ws.id, provider: "mock", name: "Sandbox", credentials: encryptJson({}) },
  });
  for (const channel of ["WHATSAPP", "SMS", "EMAIL", "VOICE"] as const) {
    await prisma.channelRoute.create({ data: { workspaceId: ws.id, channel, connectionId: sandbox.id } });
  }

  const tagData = [
    { name: "cliente", color: "#10b981" },
    { name: "lead", color: "#6366f1" },
    { name: "vip", color: "#f59e0b" },
    { name: "soporte", color: "#ef4444" },
  ];
  const tags = await Promise.all(tagData.map((t) => prisma.tag.create({ data: { ...t, workspaceId: ws.id } })));
  const tagId = (n: string) => tags.find((t) => t.name === n)!.id;

  const people = [
    ["María", "López", "maria@ejemplo.com", "+5215512345601", "Café Aroma", ["cliente", "vip"]],
    ["Jorge", "Hernández", "jorge@ejemplo.com", "+5215512345602", "Taller JH", ["lead"]],
    ["Lucía", "Martínez", "lucia@ejemplo.com", "+5215512345603", "Boutique Lu", ["cliente"]],
    ["Carlos", "Ramírez", null, "+5215512345604", null, ["lead"]],
    ["Sofía", "García", "sofia@ejemplo.com", null, "Estudio SG", ["lead", "vip"]],
    ["Diego", "Torres", "diego@ejemplo.com", "+5215512345606", "Torres & Asoc.", ["cliente", "soporte"]],
  ] as const;
  const contacts: Contact[] = [];
  for (const [firstName, lastName, mail, phone, company, t] of people) {
    const c = await prisma.contact.create({
      data: {
        workspaceId: ws.id,
        firstName,
        lastName,
        email: mail,
        phone,
        whatsapp: phone,
        company,
        customFields: { ciudad: "CDMX" },
        tags: { create: t.map((n) => ({ tagId: tagId(n) })) },
      },
    });
    contacts.push(c);
  }

  await prisma.segment.create({
    data: {
      workspaceId: ws.id,
      name: "Leads con WhatsApp",
      description: "Leads alcanzables por WhatsApp",
      rules: { match: "all", conditions: [{ field: "tag", op: "has", value: "lead" }, { field: "hasChannel", op: "has", value: "WHATSAPP" }] },
    },
  });
  await prisma.segment.create({
    data: {
      workspaceId: ws.id,
      name: "Clientes VIP",
      rules: { match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }, { field: "tag", op: "has", value: "cliente" }] },
    },
  });

  const promo = await prisma.template.create({
    data: {
      workspaceId: ws.id,
      name: "promo_temporada",
      channel: "WHATSAPP",
      body: "¡Hola {{contact.firstName}}! 🎉 Esta semana tienes 20% de descuento en {{workspace.name}}. Responde *SÍ* para apartarlo.",
      externalId: "promo_temporada",
    },
  });
  await prisma.template.create({
    data: {
      workspaceId: ws.id,
      name: "recordatorio_cita",
      channel: "SMS",
      category: "UTILITY",
      body: "{{contact.firstName}}, te recordamos tu cita mañana. Responde 1 para confirmar o 2 para reprogramar.",
    },
  });
  await prisma.template.create({
    data: {
      workspaceId: ws.id,
      name: "bienvenida",
      channel: "EMAIL",
      subject: "Bienvenido a {{workspace.name}}, {{contact.firstName}}",
      body: "Hola {{contact.firstName}},\n\nGracias por confiar en nosotros. Cualquier duda, responde a este correo.\n\nUn saludo,\nEl equipo de {{workspace.name}}",
    },
  });

  // Conversaciones de ejemplo
  const convo = async (i: number, channel: "WHATSAPP" | "SMS" | "EMAIL", msgs: [("IN" | "OUT"), string][]) => {
    const conv = await prisma.conversation.create({
      data: { workspaceId: ws.id, contactId: contacts[i].id, channel, connectionId: sandbox.id },
    });
    let t = Date.now() - msgs.length * 5 * 60000;
    for (const [dir, body] of msgs) {
      t += 5 * 60000;
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: dir === "IN" ? "INBOUND" : "OUTBOUND",
          channel,
          body,
          status: dir === "IN" ? "RECEIVED" : "DELIVERED",
          provider: "mock",
          createdAt: new Date(t),
        },
      });
    }
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date(t), lastPreview: msgs.at(-1)![1], unreadCount: msgs.at(-1)![0] === "IN" ? 1 : 0 },
    });
  };
  await convo(0, "WHATSAPP", [
    ["IN", "Hola, ¿tienen disponible el paquete empresarial?"],
    ["OUT", "¡Hola María! Sí, te comparto los detalles en un momento."],
    ["IN", "Perfecto, ¿cuál es el precio mensual?"],
  ]);
  await convo(1, "SMS", [
    ["OUT", "Jorge, te recordamos tu cita mañana. Responde 1 para confirmar."],
    ["IN", "1"],
  ]);
  await convo(5, "EMAIL", [["IN", "Buenas tardes, no puedo acceder a mi cuenta. ¿Me ayudan?"]]);

  await prisma.campaign.create({
    data: {
      workspaceId: ws.id,
      name: "Promo de temporada",
      channel: "WHATSAPP",
      templateId: promo.id,
      audience: { tagIds: [tagId("lead")], segmentIds: [], contactIds: [] },
    },
  });

  await prisma.workflow.create({
    data: {
      workspaceId: ws.id,
      name: "Respuesta a consultas de precio",
      description: "Etiqueta y responde cuando alguien pregunta por precios",
      triggerType: "message_received",
      active: true,
      graph: {
        nodes: [
          { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "message_received", channel: "ANY" } },
          {
            id: "c",
            type: "condition",
            position: { x: 0, y: 140 },
            data: { match: "any", conditions: [{ left: "{{message.body}}", op: "contains", right: "precio,costo,cuánto" }] },
          },
          { id: "tag", type: "add_tag", position: { x: -200, y: 300 }, data: { tagName: "interesado" } },
          {
            id: "msg",
            type: "send_message",
            position: { x: -200, y: 440 },
            data: { channel: "same", body: "¡Hola {{contact.firstName}}! Te comparto nuestra lista de precios: https://nexus.dev/precios" },
          },
          { id: "end", type: "end", position: { x: 200, y: 300 }, data: {} },
        ],
        edges: [
          { id: "e1", source: "t", target: "c" },
          { id: "e2", source: "c", target: "tag", sourceHandle: "true" },
          { id: "e3", source: "tag", target: "msg" },
          { id: "e4", source: "c", target: "end", sourceHandle: "false" },
        ],
      },
    },
  });

  await prisma.workflow.create({
    data: {
      workspaceId: ws.id,
      name: "Agente IA de soporte",
      description: "Responde automáticamente con IA a mensajes con la palabra 'ayuda'",
      triggerType: "message_received",
      active: false,
      graph: {
        nodes: [
          { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "message_received", channel: "ANY", keywords: "ayuda, soporte" } },
          {
            id: "ai",
            type: "ai_agent",
            position: { x: 0, y: 150 },
            data: {
              system: "Eres el asistente de soporte de {{workspace.name}}. Responde breve y amable. Si no sabes algo, ofrece pasar con un agente humano.",
              prompt: "{{message.body}}",
              saveAs: "respuesta",
              reply: true,
              includeHistory: true,
            },
          },
          { id: "assign", type: "assign", position: { x: 0, y: 300 }, data: { mode: "round_robin" } },
        ],
        edges: [
          { id: "e1", source: "t", target: "ai" },
          { id: "e2", source: "ai", target: "assign" },
        ],
      },
    },
  });

  console.log("✅ Seed completado. Inicia sesión con demo@nexus.dev / nexus1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
