import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Minus, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MIN_SECONDS = 5;
const MAX_SECONDS = 300;
const STEP_SECONDS = 5;
const DEFAULT_SECONDS = 10;

type Prefs = {
  tickets_auto_refresh_enabled: boolean;
  tickets_auto_refresh_seconds: number;
};

/**
 * Countdown badge shown at the top-left of the ticket list. Refetches the
 * tickets query when it hits zero. Enabled/interval is a per-user setting
 * persisted on profiles (tickets_auto_refresh_*) — changing it here only
 * affects the logged-in user, on every device, not the whole tenant.
 */
export function TicketAutoRefresh({ onRefresh }: { onRefresh: () => void }) {
  const qc = useQueryClient();

  const { data: prefs } = useQuery({
    queryKey: ["my-ticket-auto-refresh-prefs"],
    queryFn: async (): Promise<Prefs> => {
      const uid = getCurrentUserId();
      if (!uid)
        return {
          tickets_auto_refresh_enabled: true,
          tickets_auto_refresh_seconds: DEFAULT_SECONDS,
        };
      const { data, error } = await supabase
        .from("profiles")
        .select("tickets_auto_refresh_enabled, tickets_auto_refresh_seconds")
        .eq("id", uid)
        .maybeSingle();
      if (error) throw error;
      return {
        tickets_auto_refresh_enabled: data?.tickets_auto_refresh_enabled ?? true,
        tickets_auto_refresh_seconds: data?.tickets_auto_refresh_seconds ?? DEFAULT_SECONDS,
      };
    },
    staleTime: Infinity,
  });

  const enabled = prefs?.tickets_auto_refresh_enabled ?? true;
  const intervalSeconds = prefs?.tickets_auto_refresh_seconds ?? DEFAULT_SECONDS;

  const save = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const uid = getCurrentUserId();
      if (!uid) throw new Error("Não autenticado");
      const { error } = await supabase.from("profiles").update(patch).eq("id", uid);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-ticket-auto-refresh-prefs"] }),
  });

  const [remaining, setRemaining] = useState(intervalSeconds);

  // Reset the countdown whenever the configured interval changes.
  useEffect(() => {
    setRemaining(intervalSeconds);
  }, [intervalSeconds]);

  useEffect(() => {
    if (!enabled || !prefs) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          onRefresh();
          return intervalSeconds;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalSeconds, prefs]);

  if (!prefs) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground hover:bg-accent",
            !enabled && "opacity-50",
          )}
          title={enabled ? `Atualiza em ${remaining}s` : "Atualização automática desligada"}
        >
          <RefreshCw className={cn("h-3 w-3", enabled && "animate-[spin_3s_linear_infinite]")} />
          {enabled ? `${remaining}s` : "Off"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Atualização automática</div>
            <div className="text-[11px] text-muted-foreground">
              Recarrega a lista de tickets sozinha
            </div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => save.mutate({ tickets_auto_refresh_enabled: v })}
          />
        </div>
        <div className={cn("space-y-1.5", !enabled && "opacity-50 pointer-events-none")}>
          <div className="text-[11px] text-muted-foreground">Intervalo</div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-7 w-7"
              disabled={intervalSeconds <= MIN_SECONDS}
              onClick={() =>
                save.mutate({
                  tickets_auto_refresh_seconds: Math.max(
                    MIN_SECONDS,
                    intervalSeconds - STEP_SECONDS,
                  ),
                })
              }
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-14 text-center text-sm font-mono">{intervalSeconds}s</span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-7 w-7"
              disabled={intervalSeconds >= MAX_SECONDS}
              onClick={() =>
                save.mutate({
                  tickets_auto_refresh_seconds: Math.min(
                    MAX_SECONDS,
                    intervalSeconds + STEP_SECONDS,
                  ),
                })
              }
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Essa configuração fica salva na sua conta e vale em qualquer dispositivo.
        </p>
      </PopoverContent>
    </Popover>
  );
}
