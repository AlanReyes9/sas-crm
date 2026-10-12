import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { config } from "./config.js";
import { HttpError } from "./lib/errors.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { contactsRouter } from "./routes/contacts.js";
import { tagsRouter } from "./routes/tags.js";
import { segmentsRouter } from "./routes/segments.js";
import { conversationsRouter } from "./routes/conversations.js";
import { templatesRouter } from "./routes/templates.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { callsRouter } from "./routes/calls.js";
import { connectionsRouter } from "./routes/connections.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import { workflowsRouter } from "./routes/workflows.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { teamRouter } from "./routes/team.js";
import { devRouter } from "./routes/dev.js";
import { hooksRouter, webhooksRouter } from "./routes/webhooks.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin.split(","), credentials: true }));
  app.use(
    express.json({
      limit: "5mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf; // firma de webhooks de Meta
      },
    }),
  );
  app.use(express.urlencoded({ extended: false })); // webhooks de Twilio/Mailgun
  if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));

  app.get("/health", (_req, res) => res.json({ ok: true, service: "crm-nexus-api" }));

  // Públicos
  app.use("/api/auth", authRouter);
  app.use("/webhooks", webhooksRouter);
  app.use("/hooks", hooksRouter);

  // Protegidos (JWT + workspace)
  const api = express.Router();
  api.use(requireAuth);
  api.use("/dashboard", dashboardRouter);
  api.use("/contacts", contactsRouter);
  api.use("/tags", tagsRouter);
  api.use("/segments", segmentsRouter);
  api.use("/conversations", conversationsRouter);
  api.use("/templates", templatesRouter);
  api.use("/campaigns", campaignsRouter);
  api.use("/calls", callsRouter);
  api.use("/connections", connectionsRouter);
  api.use("/whatsapp", whatsappRouter);
  api.use("/workflows", workflowsRouter);
  api.use("/team", teamRouter);
  api.use("/dev", devRouter);
  app.use("/api", api);

  app.use((_req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Datos inválidos", details: err.flatten() });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") return res.status(409).json({ error: "Ya existe un registro con esos datos" });
      if (err.code === "P2025") return res.status(404).json({ error: "Registro no encontrado" });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  };
  app.use(onError);
  return app;
}
