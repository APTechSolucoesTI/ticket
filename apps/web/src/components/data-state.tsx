import type { LucideIcon } from "lucide-react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StateProps = {
  title: string;
  description: string;
  className?: string;
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
};

function DataState({
  title,
  description,
  className,
  icon: Icon,
  action,
  secondaryAction,
}: StateProps) {
  return (
    <section
      className={cn(
        "mx-auto flex min-h-48 w-full max-w-xl flex-col items-center justify-center rounded-lg border border-dashed bg-card/60 p-8 text-center",
        className,
      )}
      aria-live="polite"
    >
      {Icon && (
        <span className="mb-3 rounded-full bg-muted p-3 text-muted-foreground" aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {action && (
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button size="sm" variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function LoadingState({ label = "Carregando dados…" }: { label?: string }) {
  return (
    <div
      className="flex min-h-48 items-center justify-center gap-2 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState(props: Omit<StateProps, "icon">) {
  return <DataState {...props} icon={AlertCircle} />;
}

export function EmptyState(props: Omit<StateProps, "icon">) {
  return <DataState {...props} icon={Inbox} />;
}
