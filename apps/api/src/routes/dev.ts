import { Router } from "express";
import { z } from "zod";
import { ah } from "../lib/async.js";
import { recordInbound } from "../services/messaging.js";

/** Herramientas del sandbox: simular mensajes entrantes para probar bandeja y automatizaciones. */
export const devRouter = Router();

devRouter.post(
  "/simulate-inbound",
  ah(async (req, res) => {
    const body = z
      .object({
        channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
        from: z.string().min(3),
        body: z.string().min(1),
        subject: z.string().optional(),
        profileName: z.string().optional(),
      })
      .parse(req.body);
    const message = await recordInbound({ workspaceId: req.auth.workspaceId, provider: "mock", ...body });
    res.status(201).json(message);
  }),
);
