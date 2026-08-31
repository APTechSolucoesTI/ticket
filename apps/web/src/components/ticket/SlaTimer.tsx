import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type SlaState = "ok" | "warn" | "breached" | "none";

export function slaState(dueAt: string | null, totalMinutes: number): SlaState {
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  const remainingMs = due - Date.now();
  if (remainingMs <= 0) return "breached";
  const remainingMin = remainingMs / 60_000;
  if (totalMinutes > 0 && remainingMin / totalMinutes < 0.3) return "warn";
  return "ok";
}

export function slaBorderClass(state: SlaState) {
  return state === "breached"
    ? "border-l-red-500"
    : state === "warn"
      ? "border-l-yellow-500"
      : state === "ok"
        ? "border-l-green-500"
        : "border-l-transparent";
}

function format(ms: number) {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const mn = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${sign}${pad(h)}:${pad(mn)}:${pad(s)}`;
}

export function SlaTimer({
  dueAt,
  totalMinutes,
  className,
  stoppedAt,
}: {
  dueAt: string | null;
  totalMinutes: number;
  className?: string;
  stoppedAt?: string | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (stoppedAt) return;
    const i = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [stoppedAt]);

  if (!dueAt) return <span className={cn("font-mono text-xs text-muted-foreground", className)}>-</span>;
  const ref = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  const remaining = new Date(dueAt).getTime() - ref;
  const remainingMin = remaining / 60_000;
  const state: SlaState =
    remaining <= 0 ? "breached" : totalMinutes > 0 && remainingMin / totalMinutes < 0.3 ? "warn" : "ok";
  const color =
    state === "breached"
      ? "text-red-600 dark:text-red-400"
      : state === "warn"
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-green-600 dark:text-green-400";

  return (
    <span className={cn("font-mono text-sm tabular-nums", color, className)} title={stoppedAt ? "SLA pausado" : undefined}>
      {format(remaining)}{stoppedAt ? " ⏸" : ""}
    </span>
  );
}
