import { waitUntil } from "@vercel/functions";

/** true cuando la API corre como función serverless (Vercel). */
export const isServerless = Boolean(process.env.VERCEL);

/**
 * Ejecuta trabajo después de responder. En Vercel la función se congela al enviar la
 * respuesta, así que registramos la promesa con waitUntil para que termine.
 */
export function background(work: Promise<unknown>) {
  const safe = work.catch((e) => console.error("[background]", e));
  if (isServerless) waitUntil(safe);
}
