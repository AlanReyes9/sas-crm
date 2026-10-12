/**
 * Build para Vercel con la Build Output API v3 (https://vercel.com/docs/build-output-api).
 *
 *  .vercel/output/
 *    static/                 → la SPA (apps/web/dist)
 *    functions/api.func/     → la API Express empaquetada con esbuild + motor de Prisma
 *    config.json             → rutas (API, webhooks, fallback de la SPA) y cron
 *
 * Además aplica las migraciones pendientes y, si SEED_DEMO=1, carga los datos de demo.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const out = path.join(root, ".vercel/output");
const func = path.join(out, "functions/api.func");
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(func, { recursive: true });

// 1. Base de datos: migraciones (conexión directa, sin pooler) y seed opcional.
const directUrl = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (directUrl) {
  run("npx prisma migrate deploy --schema apps/api/prisma/schema.prisma", { DATABASE_URL: directUrl });
  if (process.env.SEED_DEMO === "1") run("npx tsx apps/api/prisma/seed.ts", { DATABASE_URL: directUrl });
} else {
  console.warn("⚠️  DATABASE_URL no definida: se omiten migraciones. Conecta Neon al proyecto en Vercel.");
}

// 2. Frontend (sin WebSockets: Vercel no mantiene conexiones abiertas).
run("npm run build --workspace apps/web", { VITE_REALTIME: "off" });
fs.cpSync(path.join(root, "apps/web/dist"), path.join(out, "static"), { recursive: true });

// 3. API → una sola función.
await build({
  entryPoints: [path.join(root, "apps/api/src/serverless.ts")],
  outfile: path.join(func, "app.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  logLevel: "warning",
  // WhatsApp Web no se usa en serverless; Prisma carga su motor nativo desde este directorio.
  external: ["@whiskeysockets/baileys", "pino"],
});
fs.writeFileSync(path.join(func, "index.cjs"), 'const m = require("./app.cjs");\nmodule.exports = m.default || m;\n');

// Motor de Prisma y esquema junto al bundle (Prisma los busca en __dirname).
const prismaDir = path.join(root, "node_modules/.prisma/client");
for (const f of fs.readdirSync(prismaDir)) {
  if (f.startsWith("libquery_engine-rhel") || f === "schema.prisma") fs.copyFileSync(path.join(prismaDir, f), path.join(func, f));
}

fs.writeFileSync(
  path.join(func, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.cjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);

// 4. Rutas y cron. Hobby solo permite un cron diario; el resto del trabajo diferido
//    se procesa con el tráfico (ver app.ts) o con un cron externo a /api/cron/tick.
fs.writeFileSync(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: "filesystem" },
        { src: "^/(api|webhooks|hooks)(/.*)?$", dest: "/api" },
        { src: "^/health$", dest: "/api" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
      crons: [{ path: "/api/cron/tick", schedule: "0 12 * * *" }],
    },
    null,
    2,
  ),
);
console.log("✅ Build Output listo en .vercel/output");
