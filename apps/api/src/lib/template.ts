/**
 * Motor de variables mínimo: reemplaza {{ruta.a.valor}} con datos del contexto.
 * Soporta valor por defecto: {{contact.firstName | "cliente"}}.
 */
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function render(text: string, ctx: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*"([^"]*)")?\s*\}\}/g, (_m, path: string, def?: string) => {
    const value = getPath(ctx, path);
    if (value === undefined || value === null || value === "") return def ?? "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

/** Renderiza recursivamente strings dentro de objetos/arrays (para bodies de webhooks). */
export function renderDeep<T>(value: T, ctx: Record<string, unknown>): T {
  if (typeof value === "string") return render(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, renderDeep(v, ctx)]),
    ) as T;
  }
  return value;
}

/** Lista las variables usadas en un texto. */
export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([\w.]+)/g)].map((m) => m[1]))];
}
