import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BadgeDollarSign } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { financeNavigation } from "@/lib/finance-navigation";

export const Route = createFileRoute("/_authenticated/finance/")({
  component: FinanceOverview,
});

function FinanceOverview() {
  const areas = financeNavigation.filter((item) => item.to !== "/finance");
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-emerald-500/10 p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="rounded-2xl bg-primary p-3 text-primary-foreground shadow-sm">
            <BadgeDollarSign className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Central financeira</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Escolha uma função para trabalhar. Cada área mantém seus próprios filtros e carrega
              apenas os dados necessários para a operação.
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {areas.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-md">
                <CardContent className="flex h-full items-start gap-3 p-5">
                  <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{item.label}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {areaDescription[item.to]}
                    </p>
                  </div>
                  <ArrowRight className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const areaDescription: Record<string, string> = {
  "/finance/receivables": "Revise atendimentos avulsos, medições e cobranças de clientes.",
  "/finance/payables": "Gerencie fornecedores, contratos, aprovações e pagamentos.",
  "/finance/banking": "Configure a operação bancária, importe OFX e faça conciliações.",
  "/finance/cash-flow": "Acompanhe entradas, saídas, saldos previstos e realizados.",
  "/finance/planning": "Defina orçamento por categoria, centro de custo e competência.",
  "/finance/analytics": "Analise rentabilidade, MRR e o demonstrativo gerencial.",
  "/finance/closing": "Encerre competências e consulte o histórico de revisões.",
};
