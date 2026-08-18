import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import DOMPurify from "isomorphic-dompurify";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/report/$token")({
  head: () => ({ meta: [{ title: "Relatório do atendimento — APTicket" }] }),
  component: ClosingReportPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-center text-sm text-destructive">Erro: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8 text-center text-sm">Relatório não encontrado.</div>,
});

type TimeEntry = {
  started_at: string | null;
  minutes: number;
  description: string | null;
  agent_name: string | null;
};

type ServiceItem = {
  description: string;
  complement: string | null;
};

type ClosingReport = {
  report_number: string;
  generated_at: string;
  ticket_number: number;
  subject: string;
  diagnosis_html: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  resolved_at: string | null;
  client_name: string | null;
  contact_name: string | null;
  contract_name: string | null;
  equipment_name: string | null;
  agent_name: string | null;
  total_minutes: number;
  time_entries: TimeEntry[];
  services: ServiceItem[];
  tenant_name: string | null;
};

function ClosingReportPage() {
  const { token } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["closing_report", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_closing_report_by_token", {
        _token: token,
      });
      if (error) throw error;
      if (!data) throw notFound();
      return data as unknown as ClosingReport;
    },
  });

  // ?print=1 (usado pelo botão "Imprimir" na tela do ticket) dispara o
  // diálogo de impressão assim que o relatório carrega, sem exigir clique.
  useEffect(() => {
    if (!data) return;
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("print") === "1") {
      window.print();
    }
  }, [data]);

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!data) return null;

  // Link de consulta pública/QR nunca carrega o parâmetro de auto-impressão.
  const publicUrl =
    typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
  const dateLabel = data.closed_at ? "Data e hora de fechamento" : "Data e hora de resolução";
  const dateValue = data.closed_at ?? data.resolved_at;

  return (
    <div className="min-h-screen bg-[#F0F4F8] py-8 print:bg-white print:py-0">
      <style>{`
        @media print {
          @page { margin: 12mm; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="mx-auto mb-3 flex max-w-3xl justify-end px-4 print:hidden">
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </Button>
      </div>

      <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-sm print:rounded-none print:border-none print:shadow-none">
        {/* Header */}
        <div className="relative bg-[#0D2B5E] px-8 py-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-2xl font-bold tracking-tight">APTicket</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/70">
                Relatório do Atendimento
              </div>
              <div className="mt-1 text-lg font-bold text-[#00C2CB]">{data.report_number}</div>
            </div>
            {publicUrl && (
              <div className="shrink-0 rounded-md bg-white p-1.5">
                <QRCodeSVG value={publicUrl} size={72} />
              </div>
            )}
          </div>
        </div>
        <div className="h-1 bg-[#00C2CB]" />

        {/* Meta */}
        <div className="grid grid-cols-2 gap-4 border-b border-[#E2E8F0] bg-[#F8FAFC] px-8 py-4 sm:grid-cols-3">
          <MetaItem label="Cliente" value={data.client_name ?? "—"} />
          <MetaItem label="Contato" value={data.contact_name ?? "—"} />
          <MetaItem label="Ticket" value={`#${data.ticket_number}`} />
          <MetaItem
            label="Data e hora de abertura"
            value={new Date(data.opened_at).toLocaleString("pt-BR")}
          />
          <MetaItem
            label={dateLabel}
            value={dateValue ? new Date(dateValue).toLocaleString("pt-BR") : "—"}
          />
          <MetaItem label="Contrato" value={data.contract_name ?? "—"} />
          <MetaItem label="Atendente responsável" value={data.agent_name ?? "—"} />
        </div>

        <div className="space-y-6 px-8 py-6">
          <Section title="Assunto/Solicitação">
            <p className="whitespace-pre-wrap text-sm text-[#1A1A2E]">{data.subject}</p>
          </Section>

          <Section title="Diagnóstico das ações realizadas">
            <div
              className="prose prose-sm max-w-none text-[#1A1A2E] [&_p]:my-1"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(data.diagnosis_html ?? "", {
                  ALLOWED_TAGS: [
                    "p",
                    "br",
                    "strong",
                    "em",
                    "u",
                    "s",
                    "a",
                    "ul",
                    "ol",
                    "li",
                    "h1",
                    "h2",
                    "h3",
                    "blockquote",
                    "code",
                    "pre",
                  ],
                  ALLOWED_ATTR: ["href", "target", "rel"],
                  ALLOW_DATA_ATTR: false,
                }),
              }}
            />
          </Section>

          <Section title="Serviços executados">
            {data.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum serviço registrado.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-[#E2E8F0]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#0D2B5E] text-left text-[10px] uppercase tracking-wide text-white">
                      <th className="w-10 px-3 py-2">#</th>
                      <th className="px-3 py-2">Serviço</th>
                      <th className="px-3 py-2">Complemento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.services.map((s, i) => (
                      <tr key={i} className="border-t border-[#E2E8F0]">
                        <td className="px-3 py-2 text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td className="px-3 py-2 font-medium">{s.description}</td>
                        <td className="px-3 py-2 text-muted-foreground">{s.complement ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Registro de horas">
            {data.time_entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum registro de horas.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-[#E2E8F0]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#0D2B5E] text-left text-[10px] uppercase tracking-wide text-white">
                      <th className="px-3 py-2">Início</th>
                      <th className="px-3 py-2">Duração</th>
                      <th className="px-3 py-2">Atendente</th>
                      <th className="px-3 py-2">Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.time_entries.map((t, i) => (
                      <tr key={i} className="border-t border-[#E2E8F0]">
                        <td className="px-3 py-2 text-muted-foreground">
                          {t.started_at ? new Date(t.started_at).toLocaleString("pt-BR") : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono">{t.minutes} min</td>
                        <td className="px-3 py-2">{t.agent_name ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{t.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#E2E8F0] bg-[#F8FAFC] font-medium">
                      <td className="px-3 py-2" colSpan={3}>
                        Total
                      </td>
                      <td className="px-3 py-2 font-mono">{data.total_minutes} min</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          <Section title="Equipamento vinculado">
            <p className="text-sm text-[#1A1A2E]">{data.equipment_name ?? "—"}</p>
          </Section>

          <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <div className="mb-1 text-sm font-semibold text-[#0D2B5E]">
              Validação e responsabilidade
            </div>
            <p className="text-xs text-muted-foreground">
              Relatório gerado automaticamente pelo APTicket a partir dos registros do atendimento.
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

        <div className="border-t border-[#E2E8F0] px-8 py-3 text-[10px] text-muted-foreground">
          Documento gerado pelo APTicket em {new Date(data.generated_at).toLocaleString("pt-BR")}
          {data.tenant_name ? ` — ${data.tenant_name}` : ""}.
        </div>
      </div>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#0D2B5E]">
        {title}
      </div>
      {children}
    </div>
  );
}
