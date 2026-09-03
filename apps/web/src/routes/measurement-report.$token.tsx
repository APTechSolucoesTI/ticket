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
  aprovada: "Aprovada",
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
  const isEquipmentBilling = data.billing_model === "per_equipment";
  const sortedEquipmentItems = isEquipmentBilling
    ? [...data.items].sort((first, second) =>
        first.description.localeCompare(second.description, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        }),
      )
    : data.items;
  const measurementRowCount = isEquipmentBilling
    ? Math.ceil(sortedEquipmentItems.length / 2)
    : data.items.length;
  const useCompactPrintLayout = measurementRowCount <= 12;

  return (
    <div
      className={`measurement-report-page min-h-screen overflow-x-hidden bg-[#F0F4F8] px-3 py-6 sm:px-0 sm:py-8 print:bg-white print:px-0 print:py-0 ${useCompactPrintLayout ? "measurement-report-compact" : ""}`}
    >
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          html, body { margin: 0; padding: 0; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }

          .measurement-report-page { min-height: auto; }
          .measurement-report-main { width: 100%; max-width: none; }

          .measurement-report-compact .measurement-report-main {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .measurement-report-compact .report-header { padding: 4mm 6mm; }
          .measurement-report-compact .report-header-logo { width: 10mm; height: 10mm; }
          .measurement-report-compact .report-title { font-size: 16px; line-height: 1.1; }
          .measurement-report-compact .report-number { margin-top: 1mm; font-size: 12px; line-height: 1.2; }
          .measurement-report-compact .report-qr { padding: 1mm; }
          .measurement-report-compact .report-qr svg { width: 15mm; height: 15mm; }
          .measurement-report-compact .report-accent { height: 0.8mm; }
          .measurement-report-compact .report-meta { gap: 2mm 5mm; padding: 3mm 6mm; }
          .measurement-report-compact .report-meta-label { font-size: 7px; line-height: 1.1; }
          .measurement-report-compact .report-meta-value { font-size: 9px; line-height: 1.25; }
          .measurement-report-compact .report-total-meta { padding: 2mm 3mm; }
          .measurement-report-compact .report-total-meta-value { font-size: 13px; line-height: 1.15; }
          .measurement-report-compact .report-body { padding: 4mm 6mm; }
          .measurement-report-compact .report-body > :not([hidden]) ~ :not([hidden]) { margin-top: 3mm; }
          .measurement-report-compact .report-section { break-inside: avoid; page-break-inside: avoid; }
          .measurement-report-compact .report-section-title { margin-bottom: 1.5mm; font-size: 8px; line-height: 1.1; }
          .measurement-report-compact .measurement-data { gap: 2mm 5mm; padding: 2.5mm 3mm; font-size: 9px; }
          .measurement-report-compact .report-info-label { font-size: 7px; line-height: 1.1; }
          .measurement-report-compact .report-info-value { margin-top: 0.5mm; line-height: 1.2; }
          .measurement-report-compact .equipment-item { gap: 2mm; padding: 1.5mm 2mm; }
          .measurement-report-compact .equipment-index { width: 5mm; height: 5mm; font-size: 7px; }
          .measurement-report-compact .equipment-description { font-size: 8px; line-height: 1.25; }
          .measurement-report-compact .measurement-total { padding: 2mm 3mm; }
          .measurement-report-compact .measurement-total-label { font-size: 8px; }
          .measurement-report-compact .measurement-total-value { font-size: 13px; line-height: 1.1; }
          .measurement-report-compact .measurement-table { min-width: 0; font-size: 8px; line-height: 1.2; }
          .measurement-report-compact .measurement-table th,
          .measurement-report-compact .measurement-table td { padding: 1.5mm 2mm; }
          .measurement-report-compact .measurement-table tfoot td { padding-top: 2mm; padding-bottom: 2mm; }
          .measurement-report-compact .validation-block { padding: 2.5mm 3mm; }
          .measurement-report-compact .validation-title { margin-bottom: 0.5mm; font-size: 9px; line-height: 1.15; }
          .measurement-report-compact .validation-text { font-size: 7px; line-height: 1.25; }
          .measurement-report-compact .report-footer { padding: 2mm 6mm; font-size: 6.5px; line-height: 1.2; }
        }
      `}</style>

      <div className="mx-auto mb-3 flex w-full max-w-full justify-end sm:max-w-3xl print:hidden">
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </Button>
      </div>

      <main className="measurement-report-main mx-auto w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-sm sm:max-w-3xl print:rounded-none print:border-none print:shadow-none">
        <header className="report-header relative bg-[#0D2B5E] px-6 py-6 text-white sm:px-8">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <BrandLogo
                variant="dark"
                className="report-header-logo size-12 drop-shadow-md"
                alt=""
              />
              <div className="min-w-0">
                <div className="report-title text-2xl font-bold tracking-tight">APTicket</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/70">
                  Boletim de Medição
                </div>
                <div className="report-number mt-1 break-all text-sm font-bold text-[#00C2CB] sm:break-words sm:text-lg">
                  {data.report_number}
                </div>
              </div>
            </div>
            {publicUrl && (
              <div className="report-qr hidden shrink-0 rounded-md bg-white p-1.5 sm:block print:block">
                <QRCodeSVG value={publicUrl} size={72} />
              </div>
            )}
          </div>
        </header>
        <div className="report-accent h-1 bg-[#00C2CB]" />

        <section className="report-meta grid grid-cols-2 gap-4 border-b border-[#E2E8F0] bg-[#F8FAFC] px-6 py-4 sm:grid-cols-4 sm:px-8">
          <MetaItem label="Cliente" value={data.client_name} />
          <MetaItem label="Contrato" value={data.contract_number} />
          <MetaItem label="Competência" value={formatCompetence(data.competence)} />
          <MetaItem label="Status" value={statusLabel[data.status] ?? data.status} />
          <MetaItem label="Data da medição" value={formatDate(data.measurement_date)} />
          <MetaItem label="Vencimento" value={formatDate(data.due_date)} />
          <TotalMetaItem value={money.format(Number(data.total_value))} />
        </section>

        <div className="report-body space-y-6 px-6 py-6 sm:px-8">
          <Section title="Dados da medição">
            <div className="measurement-data grid gap-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-sm sm:grid-cols-2">
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
            {isEquipmentBilling ? (
              <div className="overflow-hidden rounded-md border border-[#CBD5E1]">
                <div className="grid min-w-0 grid-cols-2 gap-px bg-[#CBD5E1]">
                  {sortedEquipmentItems.map((item, index) => (
                    <article
                      key={`${item.reference ?? "equipment"}-${index}`}
                      className="equipment-item flex min-w-0 items-start gap-2 bg-white px-2 py-2.5 sm:gap-3 sm:px-3 print:break-inside-avoid"
                    >
                      <span className="equipment-index flex size-6 shrink-0 items-center justify-center rounded-full bg-[#E6F7F8] text-[10px] font-bold tabular-nums text-[#0D6470]">
                        {index + 1}
                      </span>
                      <div className="equipment-description min-w-0 break-all text-xs font-medium leading-5 text-[#1A1A2E] sm:break-words">
                        {item.description}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="measurement-total grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-[#0D2B5E] bg-[#0D2B5E] px-3 py-3 text-white sm:gap-4 sm:px-4">
                  <span className="measurement-total-label text-xs font-semibold uppercase tracking-wide">
                    Valor total da medição
                  </span>
                  <span className="measurement-total-value text-lg font-bold tabular-nums">
                    {money.format(Number(data.total_value))}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-md border border-[#E2E8F0] sm:block print:block">
                  <table className="measurement-table w-full min-w-[620px] text-sm">
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
                          <td className="px-3 py-2 text-muted-foreground">
                            {item.reference ?? "-"}
                          </td>
                          <td className="px-3 py-2 font-medium text-[#1A1A2E]">
                            {item.description}
                          </td>
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
                          {Number(item.quantity).toLocaleString("pt-BR", {
                            maximumFractionDigits: 2,
                          })}
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
              </>
            )}
          </Section>

          <div className="validation-block rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <div className="validation-title mb-1 text-sm font-semibold text-[#0D2B5E]">
              Validação e responsabilidade
            </div>
            <p className="validation-text text-xs text-muted-foreground">
              Boletim gerado automaticamente pelo APTicket a partir do snapshot financeiro da
              medição.
            </p>
            {publicUrl && (
              <p className="validation-text mt-1 break-all text-xs text-muted-foreground">
                Consulta pública:{" "}
                <a href={publicUrl} className="text-[#1A6B8A] hover:underline">
                  {publicUrl}
                </a>
              </p>
            )}
          </div>
        </div>

        <footer className="report-footer border-t border-[#E2E8F0] px-6 py-3 text-[10px] text-muted-foreground sm:px-8">
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
      <div className="report-meta-label text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="report-meta-value text-sm font-medium text-[#1A1A2E]">{value}</div>
    </div>
  );
}

function TotalMetaItem({ value }: { value: string }) {
  return (
    <div className="report-total-meta col-span-2 flex items-center justify-between gap-3 rounded-md border border-[#00A7B0]/30 bg-[#DDF7F8] px-3 py-2 sm:justify-start">
      <div>
        <div className="report-meta-label text-[9px] font-bold uppercase tracking-wide text-[#0D6470]">
          Valor total da medição
        </div>
        <div className="report-total-meta-value text-lg font-bold tabular-nums text-[#0D2B5E]">
          {value}
        </div>
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="report-info-label text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="report-info-value mt-0.5 break-words font-medium text-[#1A1A2E]">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <h2 className="report-section-title mb-2 text-xs font-semibold uppercase tracking-wide text-[#0D2B5E]">
        {title}
      </h2>
      {children}
    </section>
  );
}
