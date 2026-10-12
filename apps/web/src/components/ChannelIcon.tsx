import clsx from "clsx";
import { Mail, MessageCircle, MessageSquareText, Phone } from "lucide-react";
import type { Channel } from "../lib/types";

const META: Record<Channel, { icon: typeof Mail; cls: string }> = {
  WHATSAPP: { icon: MessageCircle, cls: "bg-emerald-100 text-emerald-700" },
  SMS: { icon: MessageSquareText, cls: "bg-sky-100 text-sky-700" },
  EMAIL: { icon: Mail, cls: "bg-amber-100 text-amber-700" },
  VOICE: { icon: Phone, cls: "bg-violet-100 text-violet-700" },
};

export function ChannelIcon({ channel, size = "md" }: { channel: Channel; size?: "sm" | "md" }) {
  const m = META[channel];
  const Icon = m.icon;
  return (
    <span className={clsx("inline-flex items-center justify-center rounded-md", m.cls, size === "sm" ? "h-5 w-5" : "h-7 w-7")} title={channel}>
      <Icon className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
    </span>
  );
}
