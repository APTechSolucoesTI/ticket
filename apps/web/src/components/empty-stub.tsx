import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  titleId,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  titleId?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 flex min-h-[76px] flex-col gap-3 rounded-xl border bg-card px-4 py-4 shadow-md sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" /> : null}
          <h1 id={titleId} className="text-base font-semibold leading-tight text-foreground">
            {title}
          </h1>
        </div>
        {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function EmptyStub({ title, message }: { title: string; message: string }) {
  return (
    <Card className="p-8 text-center">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">{message}</p>
    </Card>
  );
}
