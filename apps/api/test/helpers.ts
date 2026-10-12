import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

export const app = createApp();

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export async function signup(company = "Acme") {
  const email = `owner+${Math.random().toString(36).slice(2)}@acme.test`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Owner", email, password: "supersecreto", company });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const token = res.body.token as string;
  const workspaceId = res.body.workspace.id as string;
  const api = {
    get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string, body?: object) => request(app).post(url).set("Authorization", `Bearer ${token}`).send(body ?? {}),
    put: (url: string, body?: object) => request(app).put(url).set("Authorization", `Bearer ${token}`).send(body ?? {}),
    patch: (url: string, body?: object) => request(app).patch(url).set("Authorization", `Bearer ${token}`).send(body ?? {}),
    delete: (url: string) => request(app).delete(url).set("Authorization", `Bearer ${token}`),
  };
  return { token, workspaceId, api };
}
