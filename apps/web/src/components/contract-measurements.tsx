import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  Printer,
  ReceiptText,
} from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@apticket/shared-types/database";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type MeasurementItem = Tables<"medicao_itens">;
type Measurement = Tables<"medicoes_contrato"> & { medicao_itens: MeasurementItem[] };

type GenerationResult = {
  processados?: number;
  geradas?: number;
  ignoradas?: number;
  erros?: number;
  detalhes?: Array<{ resultado?: string; mensagem?: string }>;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const statusLabel: Record<Measurement["status"], string> = {
  gerada: "Gerada",
  faturada: "Faturada",
  cancelada: "Cancelada",
};

const modelLabel: Record<string, string> = {
  hours_package: "Pacote de horas",
  per_equipment: "Equipamento vinculado",
  per_service: "Serviço vinculado",
};

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatCompetence(value: string) {
  const [year, month] = value.split("-");
  return year && month ? `${month}/${year}` : value;
}

export function ContractMeasurements({
  contractId,
  contractNumber,
  canGenerate,
}: {
  contractId: string;
  contractNumber: string;
  canGenerate: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["contract-measurements", contractId];

  const measurements = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medicoes_contrato")
        .select("*, medicao_itens(*)")
        .eq("contrato_id", contractId)
        .is("deleted_at", null)
        .order("competencia", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Measurement[];
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("gerar-medicoes-contrato", {
        body: { contrato_id: contractId, forcar: true },
      });
      if (error) throw error;
      return data as GenerationResult;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey });
      if ((result.erros ?? 0) > 0) {
        const detail = result.detalhes?.find((item) => item.resultado === "erro")?.mensagem;
        toast.error(detail ?? "A medição não pôde ser gerada.");
        return;
      }
      if ((result.geradas ?? 0) > 0) {
        toast.success("Medição gerada e registrada no histórico.");
        return;
      }
      toast.info("Este contrato já possui medição na competência atual.");
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível gerar a medição do contrato.")),
  });

  return (
    <section className="space-y-3" aria-label="Histórico de medições do contrato">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 text-primary" />
            Histórico de Medições
          </div>
          <p className="text-xs text-muted-foreground">
            Snapshots financeiros imutáveis do contrato {contractNumber}.
          </p>
        </div>
        {canGenerate && (
          <Button
            type="button"
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {generate.isPending ? "Gerando…" : "Gerar medição agora"}
          </Button>
        )}
      </div>

      {measurements.isLoading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando medições…
        </Card>
      ) : measurements.isError ? (
        <Card className="border-destructive/35 p-6 text-sm text-destructive">
          Não foi possível carregar o histórico de medições.
        </Card>
      ) : !measurements.data?.length ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <ReceiptText className="h-8 w-8 text-muted-foreground/60" />
          <div className="font-medium">Nenhuma medição registrada</div>
          <p className="max-w-md text-xs text-muted-foreground">
            A primeira medição aparecerá aqui após a execução automática ou pelo botão acima.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {measurements.data.map((measurement) => (
            <details
              key={measurement.id}
              className="group rounded-lg border bg-card open:shadow-sm"
            >
              <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 marker:hidden sm:flex-row sm:items-center sm:justify-between [&::-webkit-details-marker]:hidden">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-md bg-primary/10 p-2 text-primary">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">
                      Competência {formatCompetence(measurement.competencia)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {modelLabel[measurement.modelo_cobranca] ?? measurement.modelo_cobranca} ·
                      Medida em {formatDate(measurement.data_medicao)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <Badge
                    variant={measurement.status === "gerada" ? "default" : "outline"}
                    className={measurement.status === "cancelada" ? "text-destructive" : undefined}
                  >
                    {statusLabel[measurement.status]}
                  </Badge>
                  <span className="font-bold tabular-nums">
                    {money.format(Number(measurement.valor_total))}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </div>
              </summary>

              <div className="space-y-4 border-t p-4">
                <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Vencimento</dt>
                    <dd className="mt-0.5 font-medium">
                      {formatDate(measurement.data_vencimento)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Nota fiscal</dt>
                    <dd className="mt-0.5 font-medium">{measurement.emite_nf ? "Sim" : "Não"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Boleto</dt>
                    <dd className="mt-0.5 font-medium">
                      {measurement.emite_boleto ? "Sim" : "Não"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Tipo de contrato</dt>
                    <dd className="mt-0.5 font-medium">
                      {measurement.tipo_contrato_nome || "Não informado"}
                    </dd>
                  </div>
                </dl>

                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qtd.</TableHead>
                        <TableHead className="text-right">Valor unitário</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {measurement.medicao_itens.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="font-medium">{item.descricao}</div>
                            {item.referencia && (
                              <div className="text-[11px] text-muted-foreground">
                                Ref. {item.referencia}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(item.quantidade).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money.format(Number(item.valor_unitario))}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {money.format(Number(item.valor_total))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.open(`/measurement-report/${measurement.report_token}`, "_blank")
                    }
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir boletim
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `/measurement-report/${measurement.report_token}?print=1`,
                        "_blank",
                      )
                    }
                  >
                    <Printer className="h-4 w-4" />
                    Imprimir boletim
                  </Button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
