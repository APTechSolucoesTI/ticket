import { Mail, MessageCircle, MessageSquare, PenLine, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export type TicketChannel = "email" | "whatsapp" | "chat" | "manual" | "portal";

const map: Record<TicketChannel, { Icon: typeof Mail; className: string; label: string }> = {
  email: { Icon: Mail, className: "text-blue-500", label: "E-mail" },
  whatsapp: { Icon: MessageCircle, className: "text-green-500", label: "WhatsApp" },
  chat: { Icon: MessageSquare, className: "text-indigo-500", label: "Chat" },
  manual: { Icon: PenLine, className: "text-muted-foreground", label: "Manual" },
  portal: { Icon: Globe, className: "text-cyan-500", label: "Portal" },
};

export function ChannelIcon({
  channel,
  className,
  withLabel,
}: {
  channel: TicketChannel;
  className?: string;
  withLabel?: boolean;
}) {
  const cfg = map[channel];
  const Icon = cfg.Icon;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={cfg.label}>
      <Icon className={cn("h-3.5 w-3.5", cfg.className)} />
      {withLabel && <span className="text-xs">{cfg.label}</span>}
    </span>
  );
}
