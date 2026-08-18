import { ArrowDown, ArrowUp, Equal, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

export type TicketPriority = "low" | "medium" | "high" | "urgent";

const map: Record<TicketPriority, { label: string; className: string; Icon: typeof Flame }> = {
  low: { label: "Baixa", className: "text-muted-foreground", Icon: ArrowDown },
  medium: { label: "Média", className: "text-blue-600 dark:text-blue-400", Icon: Equal },
  high: { label: "Alta", className: "text-yellow-600 dark:text-yellow-400", Icon: ArrowUp },
  urgent: { label: "Urgente", className: "text-red-600 dark:text-red-400", Icon: Flame },
};

export function PriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
  const cfg = map[priority];
  const Icon = cfg.Icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", cfg.className, className)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
