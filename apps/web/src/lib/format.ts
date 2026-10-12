import { format, formatDistanceToNowStrict, isToday } from "date-fns";
import { es } from "date-fns/locale";
import type { Contact } from "./types";

export const fullName = (c?: Pick<Contact, "firstName" | "lastName"> | null) =>
  c ? `${c.firstName} ${c.lastName}`.trim() || "Sin nombre" : "Desconocido";

export const initials = (c?: Pick<Contact, "firstName" | "lastName"> | null) =>
  (fullName(c)
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2) || "?").toUpperCase();

export const relTime = (d: string | Date) => formatDistanceToNowStrict(new Date(d), { locale: es, addSuffix: true });

export const shortTime = (d: string | Date) => {
  const date = new Date(d);
  return isToday(date) ? format(date, "HH:mm") : format(date, "d MMM", { locale: es });
};

export const dateTime = (d: string | Date) => format(new Date(d), "d MMM yyyy, HH:mm", { locale: es });

export const duration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "Correo",
  VOICE: "Voz",
};
