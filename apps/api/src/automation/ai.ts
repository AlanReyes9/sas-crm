import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

let client: Anthropic | null = null;

function getClient() {
  if (!config.anthropicApiKey) {
    throw new Error("Configura ANTHROPIC_API_KEY para usar el nodo Agente IA");
  }
  client ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

export interface AgentRequest {
  system: string;
  /** Historial de la conversación (más antiguo primero). */
  history: { role: "user" | "assistant"; content: string }[];
  prompt: string;
  model?: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

/**
 * Agente IA de los workflows: responde/clasifica/extrae a partir del contexto
 * del contacto y de la conversación. Usa la Messages API de Claude.
 */
export async function runAgent(req: AgentRequest): Promise<string> {
  const anthropic = getClient();
  // La API exige alternancia user/assistant empezando por user: fusionamos turnos consecutivos.
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const turn of [...req.history, { role: "user" as const, content: req.prompt }]) {
    const last = messages[messages.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content as string}\n\n${turn.content}`;
    else messages.push({ role: turn.role, content: turn.content });
  }
  if (messages[0]?.role === "assistant") messages.unshift({ role: "user", content: "(inicio de la conversación)" });

  const response = await anthropic.beta.messages.create({
    model: req.model || config.anthropicModel,
    max_tokens: req.maxTokens ?? 4000,
    system: req.system,
    messages,
    output_config: { effort: req.effort ?? "medium" },
    // Si el modelo rechaza la petición, la API la reintenta con un modelo de respaldo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") throw new Error("El modelo rechazó la solicitud");
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
