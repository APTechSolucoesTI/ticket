import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/measurement-report/$token")({
  head: () => ({ meta: [{ title: "Boletim de medição - APTicket" }] }),
  component: MeasurementReportPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-center text-sm text-destructive">Erro: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8 text-center text-sm">Boletim não encontrado.</div>,
});

type MeasurementReportItem = {
  type: string;
  reference: string | null;
  description: string;
  quantity: number;
  unit_value: number;
  total_value: number;
};

type MeasurementReport = {
  report_number: string;
  generated_at: string;
  measurement_date: string;
  competence: string;
  due_date: string;
  contract_number: string;
  client_name: string;
  contract_type_name: string | null;
  billing_model: string;
  status: string;
  issues_invoice: boolean;
  issues_bank_slip: boolean;
  total_value: number;
  tenant_name: string | null;
  items: MeasurementReportItem[];
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const billingModelLabel: Record<string, string> = {
  hours_package: "Pacote de horas",
  per_equipment: "Por equipamento",
  per_service: "Por serviço",
};

const statusLabel: Record<string, string> = {
  gerada: "Gerada",
  faturada: "Faturada",
  cancelada: "Cancelada",
};

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatCompetence(value: string) {
  const [year, month] = value.split("-");
  return year && month ? `${month}/${year}` : value;
}

function MeasurementReportPage() {
  const { token } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["contract_measurement_report", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_contract_measurement_report_by_token", {
        _token: token,
      });
      if (error) throw error;
      if (!data) throw notFound();
      return data as unknown as MeasurementReport;
    },
  });

  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("print") === "1") window.print();
  }, [data]);

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!data) return null;

  const publicUrl =
    typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F0F4F8] px-3 py-6 sm:px-0 sm:py-8 print:bg-white print:px-0 print:py-0">
      <style>{`
        @media print {
          @page { margin: 12mm; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="mx-auto mb-3 flex w-full max-w-3xl justify-end print:hidden">
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </Button>
      </div>

      <main className="mx-auto w-full min-w-0 max-w-3xl overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-sm print:rounded-none print:border-none print:shadow-none">
        <header className="relative bg-[#0D2B5E] px-6 py-6 text-white sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <BrandLogo variant="dark" className="size-12 drop-shadow-md" alt="" />
              <div>
                <div className="text-2xl font-bold tracking-tight">APTicket</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/70">
                  Boletim de Medição
                </div>
                <div className="mt-1 break-words text-sm font-bold text-[#00C2CB] sm:text-lg">
                  {data.report_number}
                </div>
              </div>
            </div>
            {publicUrl && (
              <div className="hidden shrink-0 rounded-md bg-white p-1.5 sm:block print:block">
                <QRCodeSVG value={publicUrl} size={72} />
              </div>
            )}
          </div>
        </header>
        <div className="h-1 bg-[#00C2CB]" />

        <section className="grid grid-cols-2 gap-4 border-b border-[#E2E8F0] bg-[#F8FAFC] px-6 py-4 sm:grid-cols-3 sm:px-8">
          <MetaItem label="Cliente" value={data.client_name} />
          <MetaItem label="Contrato" value={data.contract_number} />
          <MetaItem label="Competência" value={formatCompetence(data.competence)} />
          <MetaItem label="Data da medição" value={formatDate(data.measurement_date)} />
          <MetaItem label="Vencimento" value={formatDate(data.due_date)} />
          <MetaItem label="Status" value={statusLabel[data.status] ?? data.status} />
        </section>

        <div className="space-y-6 px-6 py-6 sm:px-8">
          <Section title="Dados da medição">
            <div className="grid gap-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-sm sm:grid-cols-2">
              <InfoLine
                label="Tipo de contrato"
                value={data.contract_type_name ?? "Não informado"}
              />
              <InfoLine
                label="Modelo de cobrança"
                value={billingModelLabel[data.billing_model] ?? data.billing_model}
              />
              <InfoLine
                label="Emissão de nota fiscal"
                value={data.issues_invoice ? "Sim" : "Não"}
              />
              <InfoLine label="Emissão de boleto" value={data.issues_bank_slip ? "Sim" : "Não"} />
            </div>
          </Section>

          <Section title="Itens medidos">
            <div className="hidden overflow-x-auto rounded-md border border-[#E2E8F0] sm:block print:block">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="bg-[#0D2B5E] text-left text-[10px] uppercase tracking-wide text-white">
                    <th className="px-3 py-2">Referência</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2 text-right">Quantidade</th>
                    <th className="px-3 py-2 text-right">Valor unitário</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item, index) => (
                    <tr
                      key={`${item.reference ?? "item"}-${index}`}
                      className="border-t border-[#E2E8F0]"
                    >
                      <td className="px-3 py-2 text-muted-foreground">{item.reference ?? "-"}</td>
                      <td className="px-3 py-2 font-medium text-[#1A1A2E]">{item.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(item.quantity).toLocaleString("pt-BR", {
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money.format(Number(item.unit_value))}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {money.format(Number(item.total_value))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[#E2E8F0] bg-[#F8FAFC] font-semibold text-[#0D2B5E]">
                    <td className="px-3 py-3" colSpan={4}>
                      Valor total da medição
                    </td>
                    <td className="px-3 py-3 text-right text-base tabular-nums">
                      {money.format(Number(data.total_value))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="space-y-2 sm:hidden print:hidden">
              {data.items.map((item, index) => (
                <article
                  key={`${item.reference ?? "item"}-${index}`}
                  className="rounded-md border border-[#E2E8F0] p-3"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {item.reference ?? `Item ${index + 1}`}
                      </div>
                      <div className="mt-1 break-words text-sm font-medium text-[#1A1A2E]">
                        {item.description}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-semibold text-[#0D2B5E]">
                      {money.format(Number(item.total_value))}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-[#E2E8F0] pt-2 text-xs text-muted-foreground">
                    <span>
                      Qtd.{" "}
                      {Number(item.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                    </span>
                    <span>{money.format(Number(item.unit_value))} por unidade</span>
                  </div>
                </article>
              ))}
              <div className="flex items-center justify-between rounded-md bg-[#0D2B5E] px-3 py-3 font-semibold text-white">
                <span>Valor total</span>
                <span className="tabular-nums">{money.format(Number(data.total_value))}</span>
              </div>
            </div>
          </Section>

          <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <div className="mb-1 text-sm font-semibold text-[#0D2B5E]">
              Validação e responsabilidade
            </div>
            <p className="text-xs text-muted-foreground">
              Boletim gerado automaticamente pelo APTicket a partir do snapshot financeiro da
              medição.
            </p>
            {publicUrl && (
              <p className="mt-1 break-all text-xs text-muted-foreground">
                Consulta pública:{" "}
                <a href={publicUrl} className="text-[#1A6B8A] hover:underline">
                  {publicUrl}
                </a>
              </p>
            )}
          </div>
        </div>

        <footer className="border-t border-[#E2E8F0] px-6 py-3 text-[10px] text-muted-foreground sm:px-8">
          Documento gerado pelo APTicket em {new Date(data.generated_at).toLocaleString("pt-BR")}
          {data.tenant_name ? ` - ${data.tenant_name}` : ""}.
        </footer>
      </main>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium text-[#1A1A2E]">{value}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-medium text-[#1A1A2E]">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#0D2B5E]">{title}</h2>
      {children}
    </section>
  );
}
