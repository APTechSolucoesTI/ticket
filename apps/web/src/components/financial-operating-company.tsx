import { Building2 } from "lucide-react";

export function FinancialOperatingCompany({ name }: { name: string }) {
  return (
    <div
      role="group"
      aria-label="Empresa operadora do lançamento"
      className="flex min-w-0 items-start gap-3 rounded-xl border bg-muted/30 p-4"
    >
      <Building2 aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Empresa operadora</p>
        <p className="break-words text-sm font-semibold" aria-live="polite">
          {name}
        </p>
      </div>
    </div>
  );
}
