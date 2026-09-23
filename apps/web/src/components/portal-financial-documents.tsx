import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, ReceiptText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { portalFetch } from "@/lib/portal-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type PortalDocument = {
  id: string;
  document_type: "medicao" | "fatura" | "nfse" | "nfe" | "xml" | "boleto" | "outro";
  competencia: string;
  historico: string | null;
  file_name: string;
  file_size: number | null;
  mime_type: string;
  created_at: string;
};

const typeLabels: Record<PortalDocument["document_type"], string> = {
  medicao: "Medição",
  fatura: "Fatura",
  nfse: "NFS-e",
  nfe: "NF-e",
  xml: "XML",
  boleto: "Boleto",
  outro: "Outro",
};

export function PortalFinancialDocuments() {
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await portalFetch("/api/public/portal/documents", { method: "POST" });
      if (!response.ok) throw new Error("Falha ao consultar documentos.");
      const result = await response.json();
      setDocuments(result.documents ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, PortalDocument[]>();
    documents.forEach((document) => {
      const current = grouped.get(document.competencia) ?? [];
      current.push(document);
      grouped.set(document.competencia, current);
    });
    return Array.from(grouped.entries());
  }, [documents]);

  const download = async (document: PortalDocument) => {
    setDownloading(document.id);
    try {
      const response = await portalFetch("/api/public/portal/document-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: document.id }),
      });
      if (!response.ok) throw new Error("Download indisponível.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.file_name;
      anchor.rel = "noopener";
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Não foi possível abrir o documento.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Faturas e documentos</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Consulte seus documentos financeiros organizados por competência.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando documentos…
        </Card>
      ) : error ? (
        <Card className="border-destructive/30 p-8 text-center text-sm text-destructive">
          Não foi possível carregar os documentos. Tente novamente.
        </Card>
      ) : !groups.length ? (
        <Card className="p-12 text-center">
          <ReceiptText className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium">Nenhum documento disponível</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Quando novos documentos forem publicados, eles aparecerão aqui.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(([competencia, items]) => (
            <Card key={competencia} className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                <h3 className="font-semibold capitalize">{formatCompetencia(competencia)}</h3>
                <Badge variant="secondary">{items.length} arquivo(s)</Badge>
              </div>
              <div className="divide-y">
                {items.map((document) => (
                  <article
                    key={document.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                      {/\.(xls|xlsx)$/i.test(document.file_name) ? (
                        <FileSpreadsheet className="h-5 w-5" />
                      ) : (
                        <FileText className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{document.file_name}</p>
                        <Badge variant="outline">{typeLabels[document.document_type]}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatBytes(document.file_size ?? 0)}
                        {document.historico ? ` · ${document.historico}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={downloading === document.id}
                      onClick={() => void download(document)}
                    >
                      {downloading === document.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}{" "}
                      Baixar
                    </Button>
                  </article>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatCompetencia(value: string) {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
function formatBytes(value: number) {
  if (!value) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
