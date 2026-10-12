import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET", process.env.NODE_ENV === "test" ? "test-secret" : undefined),
  encryptionKey: required(
    "ENCRYPTION_KEY",
    process.env.NODE_ENV === "test" ? "0".repeat(64) : undefined,
  ),
  publicUrl: (
    process.env.PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:4000")
  ).replace(/\/$/, ""),
  /** Protege /api/cron/tick (Vercel Cron envía "Authorization: Bearer <CRON_SECRET>"). */
  cronSecret: process.env.CRON_SECRET ?? "",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  waSessionsDir: process.env.WA_SESSIONS_DIR ?? "./storage/wa-sessions",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  /** Desactiva el scheduler (útil en tests). */
  disableScheduler: process.env.DISABLE_SCHEDULER === "1",
};
