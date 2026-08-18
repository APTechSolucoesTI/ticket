import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-l-4 border-primary bg-primary/5 rounded-lg px-4 py-3">
      <div>
        <h2 className="text-lg font-bold text-primary uppercase tracking-wide">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
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
