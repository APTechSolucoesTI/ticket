import { cn } from "@/lib/utils";

export type TicketStatus = "new" | "in_progress" | "pending" | "resolved" | "closed";

const map: Record<TicketStatus, { label: string; className: string }> = {
  new: { label: "Novo", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  in_progress: { label: "Em atendimento", className: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30" },
  pending: { label: "Pendente", className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30" },
  resolved: { label: "Resolvido", className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
  closed: { label: "Fechado", className: "bg-muted text-muted-foreground border-border" },
};

export function TicketBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const cfg = map[status];
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium", cfg.className, className)}>
      {cfg.label}
    </span>
  );
}
