import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const NONE = "__none__";

// Campos do cadastro de equipamento que podem receber dados da planilha
const FIELD_OPTIONS: { value: string; label: string; required?: boolean }[] = [
  { value: "name", label: "Nome / Identificação", required: true },
  { value: "company_name", label: "Cliente (nome)", required: true },
  { value: "contact_name", label: "Contato (nome)" },
  { value: "type", label: "Tipo" },
  { value: "brand", label: "Marca" },
  { value: "model", label: "Modelo" },
  { value: "serial_number", label: "Número de série" },
  { value: "asset_tag", label: "Patrimônio" },
  { value: "operating_system", label: "Sistema operacional" },
  { value: "processor", label: "Processador" },
  { value: "memory", label: "Memória" },
  { value: "storage", label: "Armazenamento" },
  { value: "location", label: "Localização" },
  { value: "status", label: "Status (active/maintenance/retired)" },
  { value: "notes", label: "Observações" },
  { value: "purchase_date", label: "Data de aquisição" },
  { value: "warranty_until", label: "Garantia até" },
  { value: "os_key", label: "Chave do Sistema Operacional" },
  { value: "office_key", label: "Chave do Office" },
];

type Row = Record<string, unknown>;

function norm(s: unknown) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function guessField(header: string): string {
  const h = norm(header);
  const map: Record<string, string> = {
    nome: "name",
    identificacao: "name",
    identificação: "name",
    equipamento: "name",
    cliente: "company_name",
    empresa: "company_name",
    contato: "contact_name",
    tipo: "type",
    marca: "brand",
    modelo: "model",
    serie: "serial_number",
    série: "serial_number",
    "n° série": "serial_number",
    "numero de serie": "serial_number",
    patrimonio: "asset_tag",
    patrimônio: "asset_tag",
    so: "operating_system",
    "sistema operacional": "operating_system",
    processador: "processor",
    cpu: "processor",
    memoria: "memory",
    memória: "memory",
    ram: "memory",
    armazenamento: "storage",
    hd: "storage",
    ssd: "storage",
    localizacao: "location",
    localização: "location",
    status: "status",
    observacoes: "notes",
    observações: "notes",
    "data aquisicao": "purchase_date",
    "data de aquisição": "purchase_date",
    aquisicao: "purchase_date",
    garantia: "warranty_until",
    "garantia até": "warranty_until",
    "chave do sistema operacional": "os_key",
    "chave so": "os_key",
    "chave do office": "office_key",
    "chave office": "office_key",
  };
  return map[h] ?? NONE;
}

type SkippedRow = { row: Row; reason: string; lineNumber: number };

export function EquipmentImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const hasSpreadsheet = headers.length > 0 && rows.length > 0;

  function reset() {
    setHeaders([]);
    setRows([]);
    setMapping({});
    setFileName("");
    setSkipped([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function downloadSkipped() {
    if (!skipped.length) return;
    const aoa: unknown[][] = [
      ["Linha", "Motivo", ...headers],
      ...skipped.map((s) => [s.lineNumber, s.reason, ...headers.map((h) => s.row[h] ?? "")]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ignorados");
    XLSX.writeFile(wb, "equipamentos-ignorados.xlsx");
  }

  function downloadTemplate() {
    const headersRow = [
      "Nome",
      "Cliente",
      "Contato",
      "Tipo",
      "Marca",
      "Modelo",
      "Número de Série",
      "Patrimônio",
      "Sistema Operacional",
      "Processador",
      "Memória",
      "Armazenamento",
      "Localização",
      "Status",
      "Observações",
      "Data de Aquisição",
      "Garantia até",
      "Chave do Sistema Operacional",
      "Chave do Office",
    ];
    const sample = [
      "Notebook Diretoria",
      "ACME LTDA",
      "João Silva",
      "Notebook",
      "Dell",
      "Latitude 5430",
      "SN123456",
      "PAT-001",
      "Windows 11 Pro",
      "i7-1260P",
      "16 GB",
      "SSD 512 GB",
      "Matriz - Sala 3",
      "active",
      "Equipamento em uso",
      "2024-01-15",
      "2027-01-15",
      "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX",
      "YYYYY-YYYYY-YYYYY-YYYYY-YYYYY",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headersRow, sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Equipamentos");
    XLSX.writeFile(wb, "modelo-importacao-equipamentos.xlsx");
  }

  async function onFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Somente arquivos .xlsx são permitidos");
      return;
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: "", raw: false });
    if (!data.length) {
      toast.error("Planilha vazia");
      return;
    }
    const hs = Object.keys(data[0]).filter((h) => data.some((r) => norm(r[h]) !== ""));
    setHeaders(hs);
    setRows(data);
    setFileName(file.name);
    const initial: Record<string, string> = {};
    hs.forEach((h) => {
      initial[h] = guessField(h);
    });
    setMapping(initial);
  }

  const targetsUsed = useMemo(
    () => new Set(Object.values(mapping).filter((v) => v !== NONE)),
    [mapping],
  );

  const importMut = useMutation({
    mutationFn: async () => {
      const _tid = await getMyTenantId();
      if (!_tid) throw new Error("Tenant não encontrado");
      const prof = { tenant_id: _tid };
      if (!prof?.tenant_id) throw new Error("Tenant não encontrado");
      if (!targetsUsed.has("name") || !targetsUsed.has("company_name")) {
        throw new Error("Mapeie ao menos as colunas para 'Nome' e 'Cliente'");
      }
      const [{ data: companies }, { data: contacts }] = await Promise.all([
        supabase.from("companies").select("id, name"),
        supabase.from("contacts").select("id, name, company_id"),
      ]);
      const companyByName = new Map((companies ?? []).map((c) => [norm(c.name), c.id]));
      const contactByKey = new Map(
        (contacts ?? []).map((c) => [`${c.company_id}::${norm(c.name)}`, c.id]),
      );

      const payloads: Record<string, unknown>[] = [];
      const skippedRows: SkippedRow[] = [];
      rows.forEach((row, idx) => {
        const lineNumber = idx + 2;
        const rec: Record<string, unknown> = { tenant_id: prof.tenant_id, status: "active" };
        let companyName = "";
        let contactName = "";
        for (const [col, field] of Object.entries(mapping)) {
          if (field === NONE) continue;
          const val = String(row[col] ?? "").trim();
          if (!val) continue;
          if (field === "company_name") companyName = val;
          else if (field === "contact_name") contactName = val;
          else if (field === "status") {
            const v = norm(val);
            rec.status = ["maintenance", "manutencao", "manutenção"].includes(v)
              ? "maintenance"
              : ["retired", "baixado", "inativo"].includes(v)
                ? "retired"
                : "active";
          } else rec[field] = val;
        }
        const companyId = companyByName.get(norm(companyName));
        if (!companyId) {
          skippedRows.push({ row, lineNumber, reason: `Cliente "${companyName}" não encontrado` });
          return;
        }
        rec.company_id = companyId;
        if (contactName) {
          const cId = contactByKey.get(`${companyId}::${norm(contactName)}`);
          if (cId) rec.contact_id = cId;
        }
        if (!rec.name) {
          skippedRows.push({ row, lineNumber, reason: "Nome vazio" });
          return;
        }
        payloads.push(rec);
      });

      if (!payloads.length) {
        setSkipped(skippedRows);
        throw new Error(
          `Nenhuma linha válida (${skippedRows.length} ignorada(s)). Use "Baixar ignorados" para revisar.`,
        );
      }
      const { error } = await supabase.from("equipments").insert(payloads as never);
      if (error) throw error;
      return { inserted: payloads.length, skippedRows };
    },
    onSuccess: (r) => {
      toast.success(
        `${r.inserted} equipamento(s) importado(s)${r.skippedRows.length ? ` · ${r.skippedRows.length} ignorado(s)` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["equipments"] });
      if (r.skippedRows.length) {
        setSkipped(r.skippedRows);
        setRows([]);
        setHeaders((h) => h); // keep headers for download
      } else {
        reset();
        onOpenChange(false);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl",
          hasSpreadsheet && "sm:max-w-5xl",
        )}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6 sm:py-5">
          <DialogTitle>Importar equipamentos</DialogTitle>
          <DialogDescription>
            Envie um arquivo .xlsx. Em seguida, associe cada coluna da planilha ao campo
            correspondente.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {!headers.length && !skipped.length ? (
            <div className="space-y-3 rounded-md border border-dashed p-6 text-center sm:p-8">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Selecione uma planilha (.xlsx)</p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-1" /> Baixar modelo
                </Button>
                <Button size="sm" onClick={() => inputRef.current?.click()}>
                  Selecionar arquivo
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use o modelo para garantir que as colunas sejam reconhecidas automaticamente.
              </p>
            </div>
          ) : hasSpreadsheet ? (
            <div className="min-w-0 space-y-4">
              <div className="min-w-0 text-xs text-muted-foreground">
                <b className="break-all text-foreground">{fileName}</b> · {rows.length} linha(s)
                detectada(s). Associe as colunas:
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-2">
                {headers.map((h) => (
                  <div
                    key={h}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-center gap-2"
                  >
                    <Label className="min-w-0 truncate text-xs" title={h}>
                      {h}
                    </Label>
                    <Select
                      value={mapping[h] ?? NONE}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v }))}
                    >
                      <SelectTrigger className="h-8 min-w-0 w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>- Ignorar -</SelectItem>
                        {FIELD_OPTIONS.map((f) => (
                          <SelectItem
                            key={f.value}
                            value={f.value}
                            disabled={targetsUsed.has(f.value) && mapping[h] !== f.value}
                          >
                            {f.label}
                            {f.required ? " *" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                * Obrigatórios. O cliente é vinculado pelo <b>nome</b> exato já cadastrado.
              </p>

              <div className="min-w-0 space-y-1">
                <div className="text-xs font-medium">
                  Pré-visualização ({Math.min(rows.length, 10)} de {rows.length})
                </div>
                <div className="max-h-64 w-full max-w-full overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {headers.map((h) => {
                          const f = FIELD_OPTIONS.find((o) => o.value === mapping[h]);
                          return (
                            <TableHead key={h} className="text-[11px] whitespace-nowrap">
                              <div>{h}</div>
                              <div className="text-[10px] font-normal text-muted-foreground">
                                → {f ? f.label : "ignorar"}
                              </div>
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 10).map((r, i) => (
                        <TableRow key={i}>
                          {headers.map((h) => (
                            <TableCell
                              key={h}
                              className="text-[11px] whitespace-nowrap max-w-[200px] truncate"
                              title={String(r[h] ?? "")}
                            >
                              {String(r[h] ?? "")}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : null}

          {skipped.length > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-medium">{skipped.length} linha(s) ignorada(s)</div>
                <Button
                  className="w-full sm:w-auto"
                  variant="outline"
                  size="sm"
                  onClick={downloadSkipped}
                >
                  <Download className="h-4 w-4 mr-1" /> Baixar ignorados
                </Button>
              </div>
              <div className="border rounded-md max-h-48 overflow-auto bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px] w-16">Linha</TableHead>
                      <TableHead className="text-[11px]">Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skipped.slice(0, 50).map((s) => (
                      <TableRow key={s.lineNumber}>
                        <TableCell className="text-[11px]">{s.lineNumber}</TableCell>
                        <TableCell className="text-[11px]">{s.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t bg-background px-4 py-4 sm:px-6 sm:space-x-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            {skipped.length > 0 && !rows.length ? "Fechar" : "Cancelar"}
          </Button>
          {headers.length > 0 && rows.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={reset}>
                Trocar arquivo
              </Button>
              <Button size="sm" disabled={importMut.isPending} onClick={() => importMut.mutate()}>
                {importMut.isPending ? "Importando…" : `Importar ${rows.length} linha(s)`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
