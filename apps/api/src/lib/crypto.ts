import crypto from "node:crypto";
import { config } from "../config.js";

const key = Buffer.from(config.encryptionKey, "hex");
if (key.length !== 32) throw new Error("ENCRYPTION_KEY debe ser de 32 bytes en hex (64 caracteres)");

/** Cifra un objeto con AES-256-GCM → "iv.tag.data" en base64. */
export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptJson<T = Record<string, string>>(payload: string): T {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as T;
}

/** Muestra solo los últimos 4 caracteres de un secreto. */
export function mask(value: string | undefined): string {
  if (!value) return "";
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}
