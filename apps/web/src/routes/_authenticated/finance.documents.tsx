import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/empty-stub";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useModulePermissions } from "@/lib/permission-ui";
import { getUserFacingError } from "@/lib/user-facing-error";

export const Route = createFileRoute("/_authenticated/finance/documents")({
  head: () => ({ meta: [{ title: "Disponibilizar documentos - APTicket" }] }),
  component: FinancialDocumentsPage,
});

type DocumentType = "medicao" | "fatura" | "nfse" | "nfe" | "xml" | "boleto" | "outro";
type ClientDocument = {
  id: string;
  document_type: DocumentType;
  competencia: string;
  historico: string | null;
  file_name: string;
  file_size: number | null;
  mime_type: string;
  created_at: string;
};
type CompanyOption = { id: string; name: string; fantasy_name: string | null };

const DOCUMENT_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: "medicao", label: "Medição" },
  { value: "fatura", label: "Fatura" },
  { value: "nfse", label: "NFS-e" },
  { value: "nfe", label: "NF-e" },
  { value: "xml", label: "XML" },
  { value: "boleto", label: "Boleto" },
  { value: "outro", label: "Outro" },
];
const ALLOWED_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "xml"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function FinancialDocumentsPage() {
  const access = useModulePermissions("financeiro.disponibilizar_documentos");
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [companyId, setCompanyId] = useState("");
  const [competencia, setCompetencia] = useState(new Date().toISOString().slice(0, 7));
  const [documentType, setDocumentType] = useState<DocumentType>("fatura");
  const [historico, setHistorico] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState<ClientDocument | null>(null);
  const [archiving, setArchiving] = useState<ClientDocument | null>(null);

  const companies = useQuery({
    queryKey: ["financial-document-companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,fantasy_name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as CompanyOption[];
    },
  });

  const documents = useQuery({
    queryKey: ["client-documents", companyId],
    enabled: Boolean(companyId && access.view),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_documents")
        .select("id,document_type,competencia,historico,file_name,file_size,mime_type,created_at")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("competencia", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientDocument[];
    },
  });

  const selectedCompany = companies.data?.find((company) => company.id === companyId);
  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  const upload = useMutation({
    mutationFn: async () => {
      if (!companyId || !competencia || !files.length)
        throw new Error("Preencha os dados do envio.");
      const invalid = files.find((file) => {
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        return !ALLOWED_EXTENSIONS.has(extension) || file.size <= 0 || file.size > MAX_FILE_SIZE;
      });
      if (invalid)
        throw new Error(`${invalid.name} deve ser PDF, XLS, XLSX ou XML e ter até 10 MB.`);

      const form = new FormData();
      form.append("company_id", companyId);
      form.append("competencia", `${competencia}-01`);
      form.append("document_type", documentType);
      form.append("historico", historico.trim());
      files.forEach((file) => form.append("files", file));
      const { data, error } = await supabase.functions.invoke("client-documents-upload", {
        body: form,
      });
      if (error) throw error;
      if (!data?.documents) throw new Error(data?.message ?? "O envio não foi confirmado.");
      return data.documents as ClientDocument[];
    },
    onSuccess: (created) => {
      toast.success(`${created.length} documento(s) disponibilizado(s).`);
      setFiles([]);
      setHistorico("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["client-documents", companyId] });
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível enviar os documentos.")),
  });

  const archive = useMutation({
    mutationFn: async (document: ClientDocument) => {
      const { error } = await supabase
        .from("client_documents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", document.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Documento removido da área do cliente.");
      setArchiving(null);
      void queryClient.invalidateQueries({ queryKey: ["client-documents", companyId] });
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível remover o documento.")),
  });

  const download = async (document: ClientDocument) => {
    try {
      const { data, error } = await supabase.functions.invoke("client-document-download", {
        body: { document_id: document.id },
      });
      if (error || !data?.url) throw error ?? new Error("Link indisponível.");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(getUserFacingError(error, "Não foi possível abrir o documento."));
    }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Disponibilizar documentos"
        subtitle="Publique faturas, boletos, NFS-e e medições na área financeira do cliente."
        icon={UploadCloud}
      />

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_1fr] lg:items-end">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <CompanyCombobox
              companies={companies.data ?? []}
              value={companyId}
              onChange={setCompanyId}
              loading={companies.isLoading}
            />
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {selectedCompany ? (
              <span>
                Publicando para <strong className="text-foreground">{selectedCompany.name}</strong>.
                Os contatos financeiros desse cliente verão os documentos no portal.
              </span>
            ) : (
              "Selecione um cliente para preparar o envio e consultar o histórico."
            )}
          </div>
        </div>
      </Card>

      {companyId ? (
        <>
          {access.create ? (
            <Card className="overflow-hidden p-0">
              <div className="border-b bg-muted/25 px-4 py-3 sm:px-5">
                <h2 className="font-semibold">Novo envio</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Uma competência e um tipo podem conter vários arquivos do mesmo lote.
                </p>
              </div>
              <form
                className="space-y-4 p-4 sm:p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  upload.mutate();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="document-competencia">Competência</Label>
                    <Input
                      id="document-competencia"
                      type="month"
                      required
                      value={competencia}
                      onChange={(event) => setCompetencia(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo de documento</Label>
                    <Select
                      value={documentType}
                      onValueChange={(value) => setDocumentType(value as DocumentType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                    <Label htmlFor="document-history">Histórico</Label>
                    <Textarea
                      id="document-history"
                      rows={2}
                      maxLength={1000}
                      value={historico}
                      onChange={(event) => setHistorico(event.target.value)}
                      placeholder="Descrição opcional do lote"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-dashed p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">Arquivos do lote</p>
                      <p className="text-xs text-muted-foreground">
                        PDF, XLS, XLSX ou XML · máximo de 10 MB por arquivo
                      </p>
                    </div>
                    <Button type="button" variant="outline" asChild>
                      <label className="cursor-pointer">
                        <UploadCloud className="mr-2 h-4 w-4" /> Selecionar arquivos
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept=".pdf,.xls,.xlsx,.xml"
                          className="sr-only"
                          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                        />
                      </label>
                    </Button>
                  </div>
                  {files.length ? (
                    <div className="mt-4 space-y-2">
                      {files.map((file, index) => (
                        <div
                          key={`${file.name}-${index}`}
                          className="flex items-center gap-3 rounded-lg bg-muted/45 px-3 py-2"
                        >
                          <DocumentIcon name={file.name} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{file.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(file.size)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Remover ${file.name}`}
                            onClick={() =>
                              setFiles((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <p className="text-right text-xs text-muted-foreground">
                        {files.length} arquivo(s) · {formatBytes(totalSize)}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={upload.isPending || !files.length}>
                    {upload.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <UploadCloud className="mr-2 h-4 w-4" />
                    )}
                    {upload.isPending ? "Enviando…" : "Disponibilizar documentos"}
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}

          <DocumentList
            documents={documents.data ?? []}
            loading={documents.isLoading}
            error={documents.isError}
            canEdit={access.edit}
            canDelete={access.delete}
            onEdit={setEditing}
            onArchive={setArchiving}
            onDownload={(document) => void download(document)}
          />
        </>
      ) : null}

      <EditDocumentDialog
        document={editing}
        companyId={companyId}
        onClose={() => setEditing(null)}
      />
      <AlertDialog open={Boolean(archiving)} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover documento do portal?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiving?.file_name} deixará de aparecer para o cliente. O histórico será
              preservado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={() => archiving && archive.mutate(archiving)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CompanyCombobox({
  companies,
  value,
  onChange,
  loading,
}: {
  companies: CompanyOption[];
  value: string;
  onChange(value: string): void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = companies.find((company) => company.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {loading ? "Carregando…" : (selected?.name ?? "Buscar cliente…")}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Buscar por nome…" />
          <CommandList>
            <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
            <CommandGroup>
              {companies.map((company) => (
                <CommandItem
                  key={company.id}
                  value={`${company.name} ${company.fantasy_name ?? ""}`}
                  onSelect={() => {
                    onChange(company.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${company.id === value ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="truncate">{company.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DocumentList({
  documents,
  loading,
  error,
  canEdit,
  canDelete,
  onEdit,
  onArchive,
  onDownload,
}: {
  documents: ClientDocument[];
  loading: boolean;
  error: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit(document: ClientDocument): void;
  onArchive(document: ClientDocument): void;
  onDownload(document: ClientDocument): void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-semibold">Documentos publicados</h2>
          <p className="text-xs text-muted-foreground">
            {documents.length} arquivo(s) disponível(is)
          </p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : error ? (
        <div className="p-8 text-center text-sm text-destructive">
          Não foi possível carregar os documentos.
        </div>
      ) : !documents.length ? (
        <div className="p-10 text-center">
          <FileArchive className="mx-auto h-9 w-9 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Nenhum documento publicado</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Os próximos envios aparecerão aqui e no portal financeiro.
          </p>
        </div>
      ) : (
        <div className="divide-y">
          {documents.map((document) => (
            <article
              key={document.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5"
            >
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <DocumentIcon name={document.file_name} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{document.file_name}</p>
                  <Badge variant="secondary">{documentTypeLabel(document.document_type)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Competência {formatCompetencia(document.competencia)} ·{" "}
                  {formatBytes(document.file_size ?? 0)}
                  {document.historico ? ` · ${document.historico}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 self-end sm:self-auto">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Baixar ${document.file_name}`}
                  onClick={() => onDownload(document)}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canEdit ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Editar ${document.file_name}`}
                    onClick={() => onEdit(document)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Remover ${document.file_name}`}
                    onClick={() => onArchive(document)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function EditDocumentDialog({
  document,
  companyId,
  onClose,
}: {
  document: ClientDocument | null;
  companyId: string;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [competencia, setCompetencia] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("fatura");
  const [historico, setHistorico] = useState("");
  const open = Boolean(document);
  useEffect(() => {
    if (!document) return;
    setCompetencia(document.competencia.slice(0, 7));
    setDocumentType(document.document_type);
    setHistorico(document.historico ?? "");
  }, [document]);
  const save = useMutation({
    mutationFn: async () => {
      if (!document) return;
      const { error } = await supabase
        .from("client_documents")
        .update({
          competencia: `${competencia}-01`,
          document_type: documentType,
          historico: historico.trim() || null,
        })
        .eq("id", document.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Metadados atualizados.");
      onClose();
      void queryClient.invalidateQueries({ queryKey: ["client-documents", companyId] });
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível atualizar o documento.")),
  });
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar documento</DialogTitle>
          <DialogDescription>{document?.file_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Competência</Label>
            <Input
              type="month"
              value={competencia}
              onChange={(event) => setCompetencia(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={documentType}
              onValueChange={(value) => setDocumentType(value as DocumentType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Histórico</Label>
            <Textarea
              rows={4}
              maxLength={1000}
              value={historico}
              onChange={(event) => setHistorico(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={save.isPending || !competencia} onClick={() => save.mutate()}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentIcon({ name }: { name: string }) {
  return /\.(xls|xlsx)$/i.test(name) ? (
    <FileSpreadsheet className="h-5 w-5" />
  ) : (
    <FileText className="h-5 w-5" />
  );
}
function documentTypeLabel(type: DocumentType) {
  return DOCUMENT_TYPES.find((item) => item.value === type)?.label ?? type;
}
function formatCompetencia(value: string) {
  const [year, month] = value.split("-");
  return `${month}/${year}`;
}
function formatBytes(value: number) {
  if (!value) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
