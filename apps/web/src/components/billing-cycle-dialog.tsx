import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBillingCycle } from "@/lib/billing-cycle.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/data-state";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
const unitPrice = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 6,
});
function date(value: string, exclusiveEnd = false) {
  const day = new Date(`${value}T12:00:00Z`);
  if (exclusiveEnd) day.setUTCDate(day.getUTCDate() - 1);
  return day.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
const metrics: Record<string, string> = {
  active_users: "Usuários ativos",
  devices: "Dispositivos",
  excess_tickets: "Tickets excedentes",
  technical_hours: "Horas técnicas",
};

export function BillingCycleDialog({ id, onClose }: { id: string | null; onClose(): void }) {
  const get = useServerFn(getBillingCycle);
  const query = useQuery({
    queryKey: ["billing-cycle", id],
    queryFn: () => get({ data: { id: id! } }),
    enabled: !!id,
  });
  const cycle = query.data;
  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="mr-4">Detalhamento da fatura recorrente</DialogTitle>
          <DialogDescription>
            Valores congelados no fechamento do ciclo. Esta consulta não emite cobrança bancária nem
            altera o financeiro.
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <LoadingState label="Carregando composição da fatura…" />
        ) : query.isError ? (
          <ErrorState
            title="Fatura indisponível"
            description={query.error.message}
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : (
          cycle && (
            <>
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Período do ciclo</p>
                  <p className="mt-1 text-sm font-medium">
                    {date(cycle.cycle_start)} a {date(cycle.cycle_end, true)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vencimento no fechamento</p>
                  <p className="mt-1 text-sm font-medium">{date(cycle.due_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total original da fatura</p>
                  <p className="mt-1 text-xl font-bold text-primary tabular-nums">
                    {money.format(cycle.total_amount)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Período efetivamente atendido: {date(cycle.service_start)} a{" "}
                {date(cycle.service_end, true)}. O saldo e o vencimento atualizados permanecem na
                listagem financeira.
              </p>
              <section aria-label="Composição da fatura" className="space-y-3">
                <h3 className="font-semibold">
                  Composição da fatura{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({cycle.items.length} itens)
                  </span>
                </h3>
                {cycle.items.length === 0 ? (
                  <p role="alert" className="rounded-lg border p-3 text-sm">
                    Nenhum item disponível. Solicite a conferência desta fatura antes de prosseguir.
                  </p>
                ) : (
                  cycle.items.map((item, index) => (
                    <article key={item.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Badge variant="outline">
                            {item.kind === "fixed" ? "Parcela fixa" : "Consumo variável"}
                          </Badge>
                          <h4 className="mt-2 break-words text-sm font-medium">
                            {index + 1}.{" "}
                            {metrics[item.description.replace(/^Consumo: /, "")] ??
                              item.description}
                          </h4>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {date(item.period_start)} a {date(item.period_end, true)}
                          </p>
                        </div>
                        <p className="font-bold tabular-nums">{money.format(item.amount)}</p>
                      </div>
                      <p className="mt-3 rounded-md bg-muted/50 p-2 text-sm tabular-nums">
                        {item.kind === "fixed"
                          ? `${quantity.format(item.quantity)} dias atendidos × ${unitPrice.format(item.unit_price)} por ciclo ÷ ${item.divisor} dias do ciclo`
                          : `${quantity.format(item.quantity)} unidades faturáveis × ${unitPrice.format(item.unit_price)}`}
                      </p>
                      <details className="mt-2 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Referências de auditoria</summary>
                        <p className="mt-2 break-all">Versão do valor: {item.value_version_id}</p>
                        {item.consumption_snapshot_id && (
                          <p className="mt-1 break-all">
                            Apuração de consumo: {item.consumption_snapshot_id}
                          </p>
                        )}
                      </details>
                    </article>
                  ))
                )}
              </section>
              <p className="break-all text-xs text-muted-foreground">
                Ciclo: {cycle.id} · Empresa operadora: {cycle.operating_company_id}
              </p>
            </>
          )
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
