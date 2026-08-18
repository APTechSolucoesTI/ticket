import { cn } from "@/lib/utils";

export type PendingType = "awaiting_tech" | "awaiting_customer" | "tech_response" | null | undefined;

const map: Record<string, { label: string; className: string }> = {
  awaiting_tech: {
    label: "Pendente de Retorno Técnico",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  awaiting_customer: {
    label: "Pendente de Retorno do Cliente",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
  },
  tech_response: {
    label: "Retorno Técnico",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
};

export function PendingBadge({ pending, className }: { pending: PendingType; className?: string }) {
  if (!pending) return null;
  const cfg = map[pending];
  if (!cfg) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
        cfg.className,
        className,
      )}
    >
      {cfg.label}
    </span>
  );
}
