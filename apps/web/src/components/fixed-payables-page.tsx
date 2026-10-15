import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, Loader2, Pencil, Plus, Power, Repeat2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FinancialWorkspace } from "@/components/financial-workspace";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FixedPayableDialog } from "@/components/fixed-payable-dialog";
import { allocationSummary } from "@/lib/contract-allocations";
import {
  fixedDate,
  fixedDb,
  fixedMoney,
  fixedMonth,
  loadFixedRows,
  refreshFixedPayables,
  useFixedOccurrences,
  type FixedOccurrence,
  type FixedPayable,
} from "@/lib/fixed-payables";
import { useModulePermissions } from "@/lib/permission-ui";
import { getUserFacingError } from "@/lib/user-facing-error";

export function FixedPayablesPage() {
  const access = useModulePermissions("financeiro_contas_fixas"),
    payablesAccess = useModulePermissions("financeiro_contas_pagar");
  const client = useQueryClient();
  const [companyId, setCompanyId] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("active");
  const [form, setForm] = useState<{ template?: FixedPayable }>(),
    [selectedId, setSelectedId] = useState<string>();
  const [occurrenceForm, setOccurrenceForm] = useState<{
    row: FixedOccurrence;
    confirm: boolean;
  }>();
  const [remove, setRemove] = useState<{ template?: FixedPayable; occurrence?: FixedOccurrence }>();
  const [occurrenceFilter, setOccurrenceFilter] = useState("all");
  const companies = useQuery({
    queryKey: ["fixed-operating-companies"],
    queryFn: async () => {
      const { data, error } = await fixedDb
        .from("operating_companies")
        .select("id,legal_name")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; legal_name: string }>;
    },
  });
  useEffect(() => {
    if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id);
  }, [companyId, companies.data]);
  const templates = useQuery({
    queryKey: ["fixed-payables", companyId],
    enabled: Boolean(companyId),
    queryFn: () => loadFixedRows<FixedPayable>("fixed_payables", companyId, "description"),
  });
  const occurrences = useFixedOccurrences(companyId);
  const mutation = useMutation({
    mutationFn: async ({
      rpc,
      row,
      active,
    }: {
      rpc: string;
      row: FixedPayable | FixedOccurrence;
      active?: boolean;
    }) => {
      const { error } = await fixedDb.rpc(rpc, {
        p_id: row.id,
        p_expected_revision: row.revision,
        ...(active === undefined ? {} : { p_active: active }),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Conta fixa atualizada.");
      setRemove(undefined);
      await refreshFixedPayables(client);
    },
    onError: (e) => {
      toast.error(getUserFacingError(e));
      void refreshFixedPayables(client);
    },
  });
  const allTemplates = templates.data ?? [],
    allOccurrences = occurrences.data ?? [];
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const rows = allTemplates.filter(
    (t) =>
      (status === "all" || (status === "active" ? t.is_active : !t.is_active)) &&
      (!term || `${t.supplier_name} ${t.description}`.toLocaleLowerCase("pt-BR").includes(term)),
  );
  const selected = allTemplates.find((t) => t.id === selectedId);
  const companyName =
    companies.data?.find((company) => company.id === companyId)?.legal_name ??
    "Empresa operadora indisponível.";
  const selectedOccurrences = allOccurrences.filter(
    (o) =>
      o.fixed_payable_id === selectedId &&
      (occurrenceFilter === "all" || o.status === occurrenceFilter),
  );
  const forecasts = allOccurrences.filter((o) => o.status === "forecast");
  return (
    <FinancialWorkspace
      title="Contas a pagar fixas"
      titleId="fixed-payables-title"
      subtitle="Despesas mensais, previsões e confirmação dos documentos de cada competência."
      icon={Repeat2}
      actions={
        <Button variant="outline" asChild>
          <Link to="/finance/payables">Contas a pagar</Link>
        </Button>
      }
    >
      <Card>
        <CardContent className="max-w-md space-y-1 p-4">
          <Label htmlFor="fixed-company">Empresa operadora</Label>
          <Select
            value={companyId}
            onValueChange={(v) => {
              setCompanyId(v);
              setSelectedId(undefined);
            }}
          >
            <SelectTrigger id="fixed-company">
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent className="[&_[cmdk-item]]:text-xs">
              {(companies.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.legal_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {companies.isPending ? (
        <LoadingState label="Carregando empresas…" />
      ) : companies.isError ? (
        <ErrorState
          title="Empresas indisponíveis"
          description="Não foi possível consultar seu acesso financeiro."
          action={{ label: "Tentar novamente", onClick: () => void companies.refetch() }}
        />
      ) : !companies.data?.length ? (
        <EmptyState
          title="Sem empresa operadora"
          description="Solicite acesso financeiro a uma empresa operadora."
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-semibold">Previsões aguardando confirmação</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Valores estimados, separados dos títulos reais e do fluxo de caixa.
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-base font-semibold tabular-nums">
                  {fixedMoney.format(forecasts.reduce((sum, o) => sum + Number(o.total_amount), 0))}
                </p>
                <p className="text-xs text-muted-foreground">
                  {forecasts.length} previsões · {allTemplates.filter((t) => t.is_active).length}{" "}
                  modelos ativos
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="gap-3 border-b">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="financial-section-title text-sm">
                  Despesas recorrentes
                </CardTitle>
                {access.edit ? (
                  <Button disabled={!companyId} onClick={() => setForm({})}>
                    <Plus className="size-4" /> Nova conta fixa
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    aria-label="Buscar contas fixas"
                    placeholder="Buscar fornecedor ou descrição"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="sm:w-44" aria-label="Situação dos modelos">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="[&_[cmdk-item]]:text-xs">
                    <SelectItem value="all">Todas as situações</SelectItem>
                    <SelectItem value="active">Ativas</SelectItem>
                    <SelectItem value="inactive">Inativas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {templates.isPending || occurrences.isPending ? (
                <LoadingState label="Carregando contas fixas…" />
              ) : templates.isError || occurrences.isError ? (
                <ErrorState
                  title="Contas fixas indisponíveis"
                  description="Não foi possível consultar modelos e previsões."
                  action={{
                    label: "Tentar novamente",
                    onClick: () => {
                      void templates.refetch();
                      void occurrences.refetch();
                    },
                  }}
                />
              ) : !rows.length ? (
                <EmptyState
                  title="Nenhuma conta fixa encontrada"
                  description={
                    search || status !== "all"
                      ? "Inclua uma despesa mensal ou ajuste os filtros."
                      : "Cadastre aluguel, internet, contador e outras despesas mensais."
                  }
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table className="min-w-[1100px]">
                    <TableHeader>
                      <TableRow>
                        {[
                          "Ações",
                          "Fornecedor / descrição",
                          "Valor base",
                          "Vencimento",
                          "Início",
                          "Lançar até",
                          "Situação",
                          "Próxima previsão",
                        ].map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((t) => {
                        const next = allOccurrences.find(
                          (o) => o.fixed_payable_id === t.id && o.status === "forecast",
                        );
                        return (
                          <TableRow key={t.id}>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Ver previsões ${t.description}`}
                                  onClick={() => {
                                    setSelectedId(t.id);
                                    setOccurrenceFilter("all");
                                  }}
                                >
                                  <Eye className="size-4" />
                                </Button>
                                {access.edit ? (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`Editar conta fixa ${t.description}`}
                                      onClick={() => setForm({ template: t })}
                                    >
                                      <Pencil className="size-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      disabled={mutation.isPending}
                                      aria-label={`${t.is_active ? "Inativar" : "Reativar"} ${t.description}`}
                                      onClick={() =>
                                        mutation.mutate({
                                          rpc: "set_fixed_payable_active",
                                          row: t,
                                          active: !t.is_active,
                                        })
                                      }
                                    >
                                      <Power className="size-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="text-destructive"
                                      aria-label={`Excluir conta fixa ${t.description}`}
                                      onClick={() => setRemove({ template: t })}
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">{t.supplier_name}</p>
                              <p className="max-w-64 truncate text-xs text-muted-foreground">
                                {t.description}
                              </p>
                            </TableCell>
                            <TableCell className="font-semibold tabular-nums">
                              {fixedMoney.format(t.total_amount)}
                            </TableCell>
                            <TableCell>Dia {t.due_day}</TableCell>
                            <TableCell>{fixedMonth(t.start_month)}</TableCell>
                            <TableCell>
                              {t.end_month ? fixedMonth(t.end_month) : "Sem limite"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={t.is_active ? "secondary" : "outline"}>
                                {t.is_active ? "Ativa" : "Inativa"}
                              </Badge>
                            </TableCell>
                            <TableCell>{next ? fixedDate(next.due_date) : "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {form ? (
        <FixedPayableDialog
          companyId={companyId}
          companyName={companyName}
          template={form.template}
          onClose={() => setForm(undefined)}
        />
      ) : null}
      {selected ? (
        <Dialog open onOpenChange={(v) => !v && setSelectedId(undefined)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>Previsões da conta fixa</DialogTitle>
              <DialogDescription>
                {selected.supplier_name} · {selected.description}. Confirmadas mantêm o vínculo com
                o título e seguem o fluxo normal do contas a pagar.
              </DialogDescription>
            </DialogHeader>
            <Select value={occurrenceFilter} onValueChange={setOccurrenceFilter}>
              <SelectTrigger className="sm:w-52" aria-label="Filtrar previsões">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="[&_[cmdk-item]]:text-xs">
                <SelectItem value="all">Todas as competências</SelectItem>
                <SelectItem value="forecast">Previsões</SelectItem>
                <SelectItem value="confirmed">Confirmadas</SelectItem>
              </SelectContent>
            </Select>
            {!selectedOccurrences.length ? (
              <EmptyState
                title="Nenhuma ocorrência neste filtro"
                description="A geração respeita o período e a situação do modelo. Meses excluídos individualmente permanecem pulados."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      {[
                        "Ações",
                        "Competência",
                        "Vencimento",
                        "Valor",
                        "Situação",
                        "Classificação",
                      ].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOccurrences.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {o.status === "forecast" && access.edit ? (
                              <>
                                {payablesAccess.edit ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setOccurrenceForm({ row: o, confirm: true })}
                                  >
                                    <Check className="mr-1 size-3.5" />
                                    Confirmar
                                  </Button>
                                ) : null}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Editar previsão ${o.competence}`}
                                  onClick={() => setOccurrenceForm({ row: o, confirm: false })}
                                >
                                  <Pencil className="size-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-destructive"
                                  aria-label={`Excluir previsão ${o.competence}`}
                                  onClick={() => setRemove({ occurrence: o })}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </>
                            ) : o.status === "confirmed" && payablesAccess.view ? (
                              <Button variant="link" size="sm" asChild>
                                <Link to="/finance/payables">Ver título</Link>
                              </Button>
                            ) : (
                              "—"
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{fixedMonth(o.competence)}</TableCell>
                        <TableCell>{fixedDate(o.due_date)}</TableCell>
                        <TableCell className="font-semibold tabular-nums">
                          {fixedMoney.format(o.total_amount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={o.status === "forecast" ? "outline" : "secondary"}>
                            {o.status === "forecast" ? "Previsão" : "Confirmada"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs">{allocationSummary(o.category_allocations)}</p>
                          <p className="text-xs text-muted-foreground">
                            {allocationSummary(o.cost_center_allocations)}
                          </p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
      {occurrenceForm ? (
        <FixedPayableDialog
          companyId={companyId}
          companyName={companyName}
          occurrence={occurrenceForm.row}
          confirm={occurrenceForm.confirm}
          onClose={() => setOccurrenceForm(undefined)}
        />
      ) : null}
      <AlertDialog
        open={Boolean(remove)}
        onOpenChange={(v) => !v && !mutation.isPending && setRemove(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {remove?.template ? "Excluir conta fixa?" : "Excluir esta previsão?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {remove?.template
                ? "O modelo e suas previsões ainda não confirmadas serão excluídos. Títulos confirmados e seu histórico serão preservados."
                : "Esta competência será pulada e não será recriada pela geração automática. As demais previsões permanecem."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => setRemove(undefined)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => {
                const row = remove?.template ?? remove?.occurrence;
                if (row)
                  mutation.mutate({
                    rpc: remove?.template
                      ? "delete_fixed_payable"
                      : "skip_fixed_payable_occurrence",
                    row,
                  });
              }}
            >
              {mutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FinancialWorkspace>
  );
}
