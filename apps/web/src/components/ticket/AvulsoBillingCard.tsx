import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useModulePermissions } from "@/lib/permission-ui";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const labels: Record<string, string> = {
  a_faturar: "A faturar",
  faturado: "Faturado",
  vencido: "Vencido",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

export function AvulsoBillingCard({ ticketId }: { ticketId: string }) {
  const finance = useModulePermissions("financeiro");
  const { data, isLoading } = useQuery({
    queryKey: ["avulso-charge", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets_cobranca_avulsa")
        .select("minutos_apurados, status_cobranca, vencimento_em, revisado_em")
        .eq("ticket_id", ticketId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: financialData, isLoading: isFinancialLoading } = useQuery({
    queryKey: ["avulso-charge-financial-value", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets_cobranca_avulsa")
        .select("valor_final, valor_ajustado_manualmente")
        .eq("ticket_id", ticketId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !finance.loading && finance.view,
  });

  const status =
    data?.status_cobranca === "faturado" &&
    data.vencimento_em &&
    data.vencimento_em < new Date().toISOString().slice(0, 10)
      ? "vencido"
      : data?.status_cobranca;

  return (
    <Card className="mt-3 border-amber-500/40 bg-amber-500/5">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="flex items-center gap-2 text-xs uppercase text-amber-700 dark:text-amber-300">
          <CircleDollarSign className="size-4" /> Cobrança avulsa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0 text-xs">
        {isLoading ? (
          <p className="text-muted-foreground">Calculando cobrança…</p>
        ) : data ? (
          <>
            <div className={`grid gap-2 ${finance.view ? "grid-cols-2" : "grid-cols-1"}`}>
              <div>
                <span className="text-muted-foreground">Tempo</span>
                <div className="font-medium">
                  {Math.floor(data.minutos_apurados / 60)}h {data.minutos_apurados % 60}min
                </div>
              </div>
              {finance.view && (
                <div>
                  <span className="text-muted-foreground">Valor final</span>
                  <div className="font-semibold">
                    {isFinancialLoading || !financialData
                      ? "Carregando…"
                      : money.format(Number(financialData.valor_final))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{labels[status ?? ""] ?? status}</Badge>
              {!data.revisado_em && (
                <span className="text-amber-700 dark:text-amber-300">
                  Revisão financeira pendente
                </span>
              )}
              {finance.view && financialData?.valor_ajustado_manualmente && (
                <span className="text-muted-foreground">Valor ajustado</span>
              )}
            </div>
            {finance.view && (
              <Button asChild size="sm" variant="outline" className="h-7 w-full">
                <Link to="/finance">Abrir no financeiro</Link>
              </Button>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Cobrança ainda não disponível.</p>
        )}
      </CardContent>
    </Card>
  );
}
