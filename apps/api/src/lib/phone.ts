/**
 * Normaliza un número a E.164. Si no trae prefijo internacional se asume
 * el código de país por defecto (52 = México).
 */
export function toE164(raw: string | null | undefined, defaultCountry = "52"): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^whatsapp:/i, "");
  const plus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  else if (!plus && s.length === 10) s = defaultCountry + s;
  if (s.length < 8 || s.length > 15) return null;
  return `+${s}`;
}

export const isE164 = (s: string) => /^\+[1-9]\d{7,14}$/.test(s);

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
