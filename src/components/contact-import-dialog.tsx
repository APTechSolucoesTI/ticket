import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { unmask } from "@/lib/masks";

const NONE = "__none__";

const FIELD_OPTIONS: { value: string; label: string; required?: boolean }[] = [
  { value: "name", label: "Nome", required: true },
  { value: "company_name", label: "Cliente (nome)", required: true },
  { value: "email", label: "E-mail", required: true },
  { value: "phone", label: "Telefone" },
  { value: "job_title", label: "Cargo" },
  { value: "notes", label: "Observações" },
  { value: "can_open_tickets", label: "Pode abrir tickets (sim/não)" },
  { value: "receives_csat", label: "Recebe CSAT (sim/não)" },
  { value: "is_active", label: "Ativo (sim/não)" },
];

type Row = Record<string, unknown>;
type SkippedRow = { row: Row; reason: string; lineNumber: number };

function norm(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function parseBool(v: string, fallback: boolean): boolean {
  const n = norm(v);
  if (["sim", "s", "true", "1", "yes", "y", "ativo"].includes(n)) return true;
  if (["nao", "não", "n", "false", "0", "no", "inativo"].includes(n)) return false;
  return fallback;
}

function guessField(header: string): string {
  const h = norm(header);
  const map: Record<string, string> = {
    nome: "name", contato: "name",
    cliente: "company_name", empresa: "company_name",
    email: "email", "e-mail": "email", mail: "email",
    telefone: "phone", fone: "phone", celular: "phone", phone: "phone",
    cargo: "job_title", funcao: "job_title", "função": "job_title", "job title": "job_title",
    observacoes: "notes", "observações": "notes", notas: "notes",
    "pode abrir tickets": "can_open_tickets", "abre tickets": "can_open_tickets",
    csat: "receives_csat", "recebe csat": "receives_csat",
    ativo: "is_active", status: "is_active",
  };
  return map[h] ?? NONE;
}

export function ContactImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);

  function reset() {
    setHeaders([]); setRows([]); setMapping({}); setFileName(""); setSkipped([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function downloadTemplate() {
    const headersRow = ["Nome", "Cliente", "E-mail", "Telefone", "Cargo", "Observações", "Pode abrir tickets", "Recebe CSAT", "Ativo"];
    const sample = ["João Silva", "ACME LTDA", "joao@acme.com", "(11) 98888-7777", "Gerente de TI", "Contato principal", "sim", "sim", "sim"];
    const ws = XLSX.utils.aoa_to_sheet([headersRow, sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contatos");
    XLSX.writeFile(wb, "modelo-importacao-contatos.xlsx");
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
    XLSX.writeFile(wb, "contatos-ignorados.xlsx");
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
    if (!data.length) { toast.error("Planilha vazia"); return; }
    const hs = Object.keys(data[0]).filter((h) => data.some((r) => norm(r[h]) !== ""));
    setHeaders(hs);
    setRows(data);
    setFileName(file.name);
    const initial: Record<string, string> = {};
    hs.forEach((h) => { initial[h] = guessField(h); });
    setMapping(initial);
  }

  const targetsUsed = useMemo(() => new Set(Object.values(mapping).filter((v) => v !== NONE)), [mapping]);

  const importMut = useMutation({
    mutationFn: async () => {
      const _tid = await getMyTenantId();
      if (!_tid) throw new Error("Tenant não encontrado");
      const prof = { tenant_id: _tid };
      if (!prof?.tenant_id) throw new Error("Tenant não encontrado");
      if (!targetsUsed.has("name") || !targetsUsed.has("company_name") || !targetsUsed.has("email")) {
        throw new Error("Mapeie ao menos 'Nome', 'Cliente' e 'E-mail'");
      }
      const { data: companies } = await supabase.from("companies").select("id, name");
      const companyByName = new Map((companies ?? []).map((c) => [norm(c.name), c.id]));

      const payloads: Record<string, unknown>[] = [];
      const skippedRows: SkippedRow[] = [];
      rows.forEach((row, idx) => {
        const lineNumber = idx + 2;
        const rec: Record<string, unknown> = {
          tenant_id: prof.tenant_id,
          can_open_tickets: true, receives_csat: true, is_active: true,
        };
        let companyName = "";
        for (const [col, field] of Object.entries(mapping)) {
          if (field === NONE) continue;
          const val = String(row[col] ?? "").trim();
          if (!val) continue;
          if (field === "company_name") companyName = val;
          else if (field === "email") rec.email = val.toLowerCase();
          else if (field === "phone") rec.phone = unmask(val) || val;
          else if (field === "can_open_tickets") rec.can_open_tickets = parseBool(val, true);
          else if (field === "receives_csat") rec.receives_csat = parseBool(val, true);
          else if (field === "is_active") rec.is_active = parseBool(val, true);
          else rec[field] = val;
        }
        const companyId = companyByName.get(norm(companyName));
        if (!companyId) { skippedRows.push({ row, lineNumber, reason: `Cliente "${companyName}" não encontrado` }); return; }
        rec.company_id = companyId;
        if (!rec.name) { skippedRows.push({ row, lineNumber, reason: "Nome vazio" }); return; }
        if (!rec.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(rec.email))) {
          skippedRows.push({ row, lineNumber, reason: "E-mail inválido ou vazio" }); return;
        }
        payloads.push(rec);
      });

      if (!payloads.length) {
        setSkipped(skippedRows);
        throw new Error(`Nenhuma linha válida (${skippedRows.length} ignorada(s)). Use "Baixar ignorados" para revisar.`);
      }
      const { error } = await supabase.from("contacts").insert(payloads as never);
      if (error) throw error;
      return { inserted: payloads.length, skippedRows };
    },
    onSuccess: (r) => {
      toast.success(`${r.inserted} contato(s) importado(s)${r.skippedRows.length ? ` · ${r.skippedRows.length} ignorado(s)` : ""}`);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      if (r.skippedRows.length) {
        setSkipped(r.skippedRows);
        setRows([]);
      } else {
        reset(); onOpenChange(false);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>
            Envie um arquivo .xlsx. Em seguida, associe cada coluna da planilha ao campo correspondente.
          </DialogDescription>
        </DialogHeader>

        {!headers.length && !skipped.length ? (
          <div className="border border-dashed rounded-md p-8 text-center space-y-3">
            <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Selecione uma planilha (.xlsx)</p>
            <input
              ref={inputRef} type="file" accept=".xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-1" /> Baixar modelo
              </Button>
              <Button size="sm" onClick={() => inputRef.current?.click()}>Selecionar arquivo</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              O cliente é vinculado pelo <b>nome</b> exato já cadastrado.
            </p>
          </div>
        ) : headers.length > 0 && rows.length > 0 ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              <b>{fileName}</b> · {rows.length} linha(s) detectada(s). Associe as colunas:
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {headers.map((h) => (
                <div key={h} className="grid grid-cols-2 gap-2 items-center">
                  <Label className="text-xs truncate" title={h}>{h}</Label>
                  <Select value={mapping[h] ?? NONE} onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Ignorar —</SelectItem>
                      {FIELD_OPTIONS.map((f) => (
                        <SelectItem key={f.value} value={f.value}
                          disabled={targetsUsed.has(f.value) && mapping[h] !== f.value}>
                          {f.label}{f.required ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">* Obrigatórios.</p>

            <div className="space-y-1">
              <div className="text-xs font-medium">Pré-visualização ({Math.min(rows.length, 10)} de {rows.length})</div>
              <div className="border rounded-md max-h-64 overflow-auto">
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
                          <TableCell key={h} className="text-[11px] whitespace-nowrap max-w-[200px] truncate" title={String(r[h] ?? "")}>
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
          <div className="border rounded-md p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium">{skipped.length} linha(s) ignorada(s)</div>
              <Button variant="outline" size="sm" onClick={downloadSkipped}>
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

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => { reset(); onOpenChange(false); }}>
            {skipped.length > 0 && !rows.length ? "Fechar" : "Cancelar"}
          </Button>
          {headers.length > 0 && rows.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={reset}>Trocar arquivo</Button>
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
