import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileUp, Landmark, Loader2, Plus, RefreshCcw, Search, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { supabase } from "@/integrations/supabase/client";
import { readOfxFile } from "@/lib/ofx-parser";
import { getUserFacingError } from "@/lib/user-facing-error";

type Company = { id: string; legal_name: string };
type BankAccount = {
  id: string;
  name: string;
  bank_name: string;
  branch: string | null;
  account_number: string;
  is_default: boolean;
};
type Transaction = {
  id: string;
  posted_at: string;
  amount: number;
  memo: string;
  document_number: string | null;
  reconciliation_status: "pending_review" | "matched_auto" | "matched_manual" | "ignored";
  match_source_type: "measurement_receivable" | "recurring_receivable" | "supplier_payment" | null;
  match_source_id: string | null;
  match_document_number: string | null;
  match_counterparty_name: string | null;
  difference_amount: number | null;
  resolution_notes: string | null;
};
type Candidate = {
  id: string;
  sourceType: "measurement_receivable" | "recurring_receivable" | "supplier_payment";
  document: string;
  counterparty: string;
  date: string;
  amount: number;
};

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const statusLabels = {
  pending_review: "Revisar",
  matched_auto: "Automática",
  matched_manual: "Manual",
  ignored: "Ignorado",
};

function errorMessage(error: unknown) {
  if (error instanceof Error && !error.message.toLowerCase().includes("invalid input"))
    return error.message;
  return getUserFacingError(error);
}

export function BankReconciliationDashboard({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [companyId, setCompanyId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState<"all" | Transaction["reconciliation_status"]>(
    "pending_review",
  );
  const [search, setSearch] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [reviewing, setReviewing] = useState<Transaction>();
  const [candidateId, setCandidateId] = useState("");
  const [notes, setNotes] = useState("");
  const [accountForm, setAccountForm] = useState({
    name: "Conta principal",
    bankCode: "",
    bankName: "",
    branch: "",
    accountNumber: "",
    accountType: "checking",
    openingBalance: "0",
  });

  const companies = useQuery({
    queryKey: ["bank-reconciliation-companies"],
    queryFn: async () => {
      const { data, error } = await db
        .from("operating_companies")
        .select("id,legal_name")
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []) as Company[];
    },
  });
  useEffect(() => {
    if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);

  const accounts = useQuery({
    queryKey: ["operating-bank-accounts", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await db
        .from("operating_bank_accounts")
        .select("id,name,bank_name,branch,account_number,is_default")
        .eq("operating_company_id", companyId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as BankAccount[];
    },
  });
  useEffect(() => {
    if (!accounts.data?.some((item) => item.id === accountId))
      setAccountId(accounts.data?.[0]?.id ?? "");
  }, [accountId, accounts.data]);

  const transactions = useQuery({
    queryKey: ["bank-statement-transactions", companyId, accountId],
    enabled: Boolean(companyId && accountId),
    queryFn: async () => {
      const { data, error } = await db
        .from("bank_statement_transactions")
        .select("*")
        .eq("operating_company_id", companyId)
        .eq("bank_account_id", accountId)
        .is("deleted_at", null)
        .order("posted_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Transaction[];
    },
  });

  const candidates = useQuery({
    queryKey: ["bank-reconciliation-candidates", reviewing?.id],
    enabled: Boolean(reviewing && companyId),
    queryFn: async () => {
      if (!reviewing) return [];
      if (reviewing.amount > 0) {
        const { data, error } = await db
          .from("contas_receber")
          .select("id,documento_referencia,cliente_nome,vencimento_em,valor_aberto,medicao_id")
          .eq("operating_company_id", companyId)
          .gt("valor_aberto", 0)
          .is("deleted_at", null)
          .order("vencimento_em")
          .limit(500);
        if (error) throw error;
        return (data ?? []).map((item: Record<string, unknown>) => ({
          id: String(item.id),
          sourceType: item.medicao_id ? "measurement_receivable" : "recurring_receivable",
          document: String(item.documento_referencia),
          counterparty: String(item.cliente_nome),
          date: String(item.vencimento_em),
          amount: Number(item.valor_aberto),
        })) as Candidate[];
      }
      const { data, error } = await db
        .from("supplier_payments")
        .select(
          "id,scheduled_date,scheduled_amount,supplier_payables(document_number,terms_snapshot)",
        )
        .eq("operating_company_id", companyId)
        .eq("status", "scheduled")
        .order("scheduled_date")
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((item: Record<string, unknown>) => {
        const payable = item.supplier_payables as Record<string, unknown> | null;
        const snapshot = payable?.terms_snapshot as Record<string, unknown> | null;
        return {
          id: String(item.id),
          sourceType: "supplier_payment",
          document: String(payable?.document_number ?? ""),
          counterparty: String(snapshot?.supplier_name ?? "Fornecedor"),
          date: String(item.scheduled_date),
          amount: Number(item.scheduled_amount),
        } as Candidate;
      });
    },
  });

  const filtered = useMemo(
    () =>
      (transactions.data ?? []).filter((item) => {
        if (status !== "all" && item.reconciliation_status !== status) return false;
        const term = search.trim().toLocaleLowerCase("pt-BR");
        return (
          !term ||
          `${item.memo} ${item.document_number ?? ""} ${item.match_counterparty_name ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(term)
        );
      }),
    [search, status, transactions.data],
  );
  const pending = (transactions.data ?? []).filter(
    (item) => item.reconciliation_status === "pending_review",
  ).length;
  const matched = (transactions.data ?? []).filter((item) =>
    item.reconciliation_status.startsWith("matched"),
  ).length;
  const balance = (transactions.data ?? []).reduce((sum, item) => sum + Number(item.amount), 0);

  const saveAccount = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("save_operating_bank_account", {
        p_id: null,
        p_operating_company_id: companyId,
        p_name: accountForm.name,
        p_bank_code: accountForm.bankCode || null,
        p_bank_name: accountForm.bankName,
        p_branch: accountForm.branch || null,
        p_account_number: accountForm.accountNumber,
        p_account_type: accountForm.accountType,
        p_opening_balance: Number(accountForm.openingBalance || 0),
        p_is_default: !accounts.data?.length,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["operating-bank-accounts", companyId] });
      setAccountOpen(false);
      toast.success("Conta bancária cadastrada.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const importOfx = useMutation({
    mutationFn: async (file: File) => {
      if (!accountId) throw new Error("Selecione uma conta bancária antes de importar.");
      const parsed = await readOfxFile(file);
      const { error } = await db.rpc("import_bank_statement", {
        p_bank_account_id: accountId,
        p_source_type: "ofx",
        p_file_name: file.name,
        p_file_hash: parsed.hash,
        p_period_start: parsed.periodStart,
        p_period_end: parsed.periodEnd,
        p_transactions: parsed.transactions,
      });
      if (error) throw error;
      return parsed.transactions.length;
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({
        queryKey: ["bank-statement-transactions", companyId, accountId],
      });
      toast.success(`${count} movimento(s) processado(s).`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resolve = useMutation({
    mutationFn: async (action: "match" | "ignore") => {
      if (!reviewing) return;
      if (action === "ignore") {
        const { error } = await db.rpc("ignore_bank_transaction", {
          p_transaction_id: reviewing.id,
          p_reason: notes,
        });
        if (error) throw error;
        return;
      }
      const selected = candidates.data?.find((item) => item.id === candidateId);
      if (!selected) throw new Error("Selecione um lançamento financeiro.");
      const { error } = await db.rpc("reconcile_bank_transaction", {
        p_transaction_id: reviewing.id,
        p_source_type: selected.sourceType,
        p_source_id: selected.id,
        p_notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["bank-statement-transactions", companyId, accountId],
      });
      setReviewing(undefined);
      setCandidateId("");
      setNotes("");
      toast.success("Movimento atualizado.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card id="bank-reconciliation">
      <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="size-5" /> Conciliação bancária
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Importe extratos OFX e revise os movimentos sem correspondência única.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".ofx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importOfx.mutate(file);
              event.currentTarget.value = "";
            }}
          />
          <Button
            variant="outline"
            onClick={() => setAccountOpen(true)}
            disabled={!canEdit || !companyId}
          >
            <Plus className="mr-2 size-4" />
            Conta
          </Button>
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={!canEdit || !accountId || importOfx.isPending}
          >
            {importOfx.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 size-4" />
            )}
            Importar OFX
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            value={companyId}
            onValueChange={(value) => {
              setCompanyId(value);
              setAccountId("");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Empresa operadora" />
            </SelectTrigger>
            <SelectContent>
              {companies.data?.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.legal_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Conta bancária" />
            </SelectTrigger>
            <SelectContent>
              {accounts.data?.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · {item.bank_name} · {item.account_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {accounts.isLoading ? (
          <LoadingState />
        ) : accounts.isError ? (
          <ErrorState
            title="Não foi possível carregar as contas bancárias"
            description="Atualize a consulta para tentar novamente."
            action={{ label: "Atualizar", onClick: () => void accounts.refetch() }}
          />
        ) : !accounts.data?.length ? (
          <EmptyState
            title="Nenhuma conta bancária"
            description="Cadastre uma conta operacional para importar extratos."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Pendentes" value={String(pending)} />
              <Metric label="Conciliados" value={String(matched)} />
              <Metric label="Saldo dos movimentos" value={money.format(balance)} />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar histórico, documento ou contraparte"
                />
              </div>
              <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                <SelectTrigger className="sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {transactions.isLoading ? (
              <LoadingState />
            ) : transactions.isError ? (
              <ErrorState
                title="Não foi possível carregar os movimentos"
                description="Atualize a consulta para tentar novamente."
                action={{ label: "Atualizar", onClick: () => void transactions.refetch() }}
              />
            ) : !filtered.length ? (
              <EmptyState
                title="Nenhum movimento encontrado"
                description="Importe um OFX ou ajuste os filtros."
              />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Histórico</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Correspondência</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          {dateFormat.format(new Date(`${item.posted_at}T00:00:00Z`))}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{item.memo}</p>
                          {item.document_number && (
                            <p className="text-xs text-muted-foreground">
                              Doc. {item.document_number}
                            </p>
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right font-semibold ${item.amount < 0 ? "text-red-600" : "text-emerald-600"}`}
                        >
                          {money.format(item.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.reconciliation_status === "pending_review"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {statusLabels[item.reconciliation_status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p>{item.match_document_number ?? "Sem vínculo"}</p>
                          {item.match_counterparty_name && (
                            <p className="text-xs text-muted-foreground">
                              {item.match_counterparty_name}
                            </p>
                          )}
                          {Number(item.difference_amount) !== 0 &&
                            item.difference_amount !== null && (
                              <p className="text-xs text-amber-700">
                                Diferença: {money.format(item.difference_amount)}
                              </p>
                            )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.reconciliation_status === "pending_review" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canEdit}
                              onClick={() => {
                                setReviewing(item);
                                setCandidateId("");
                                setNotes("");
                              }}
                            >
                              Revisar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova conta bancária</DialogTitle>
            <DialogDescription>
              A conta fica vinculada somente à empresa operadora selecionada.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nome"
              value={accountForm.name}
              onChange={(value) => setAccountForm((old) => ({ ...old, name: value }))}
            />
            <Field
              label="Código do banco"
              value={accountForm.bankCode}
              onChange={(value) => setAccountForm((old) => ({ ...old, bankCode: value }))}
            />
            <Field
              label="Banco"
              value={accountForm.bankName}
              onChange={(value) => setAccountForm((old) => ({ ...old, bankName: value }))}
            />
            <Field
              label="Agência"
              value={accountForm.branch}
              onChange={(value) => setAccountForm((old) => ({ ...old, branch: value }))}
            />
            <Field
              label="Conta"
              value={accountForm.accountNumber}
              onChange={(value) => setAccountForm((old) => ({ ...old, accountNumber: value }))}
            />
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={accountForm.accountType}
                onValueChange={(value) => setAccountForm((old) => ({ ...old, accountType: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Corrente</SelectItem>
                  <SelectItem value="savings">Poupança</SelectItem>
                  <SelectItem value="payment">Pagamento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field
              label="Saldo inicial"
              value={accountForm.openingBalance}
              type="number"
              onChange={(value) => setAccountForm((old) => ({ ...old, openingBalance: value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => saveAccount.mutate()} disabled={saveAccount.isPending}>
              {saveAccount.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(reviewing)}
        onOpenChange={(open) => {
          if (!open) setReviewing(undefined);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Revisar movimento bancário</DialogTitle>
            <DialogDescription>
              {reviewing && `${reviewing.memo} · ${money.format(reviewing.amount)}`}
            </DialogDescription>
          </DialogHeader>
          {candidates.isLoading ? (
            <LoadingState />
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Lançamento financeiro</Label>
                <Select value={candidateId} onValueChange={setCandidateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a correspondência" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.data?.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.document} · {item.counterparty} · {money.format(item.amount)} ·{" "}
                        {dateFormat.format(new Date(`${item.date}T00:00:00Z`))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Observação ou justificativa</Label>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Obrigatória ao ignorar o movimento"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="destructive"
              disabled={resolve.isPending || notes.trim().length < 3}
              onClick={() => resolve.mutate("ignore")}
            >
              <Unlink className="mr-2 size-4" />
              Ignorar
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setReviewing(undefined)}>
                Cancelar
              </Button>
              <Button
                disabled={resolve.isPending || !candidateId}
                onClick={() => resolve.mutate("match")}
              >
                {resolve.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 size-4" />
                )}
                Conciliar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
