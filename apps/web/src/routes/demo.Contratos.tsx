import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { demoContracts } from "@/lib/demo-seed";

export const Route = createFileRoute("/demo/Contratos")({
  head: () => ({ meta: [{ title: "Contratos - Demo APTicket" }, { name: "robots", content: "noindex" }] }),
  component: DemoContratos,
});

function DemoContratos() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Contratos</h1>
        <p className="text-sm text-muted-foreground">Franquia de horas, SLA e vigência por cliente.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {demoContracts.map((k) => {
          const pct = Math.round((k.horas_utilizadas / k.horas_contratadas) * 100);
          const alerta = pct >= 80;
          return (
            <Card key={k.id} className={alerta ? "border-amber-300" : ""}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{k.company}</div>
                    <div className="text-xs text-muted-foreground">{k.tipo}</div>
                  </div>
                  {k.ativo
                    ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Ativo</Badge>
                    : <Badge variant="destructive">Vencido</Badge>}
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Horas utilizadas</span>
                    <span className={alerta ? "font-semibold text-amber-700" : ""}>
                      {k.horas_utilizadas} / {k.horas_contratadas}h
                    </span>
                  </div>
                  <Progress value={pct} className={alerta ? "[&>div]:bg-amber-500" : ""} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div>
                    <div className="text-muted-foreground">SLA resposta</div>
                    <div className="font-medium">{k.sla_horas}h</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Vencimento</div>
                    <div className="font-medium">{new Date(k.vencimento).toLocaleDateString("pt-BR")}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
