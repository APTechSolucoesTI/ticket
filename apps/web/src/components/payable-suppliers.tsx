import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FilePlus2, Loader2, PackageSearch, Percent, Search } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/empty-stub";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FinancialCurrencyInput } from "@/components/ui/decimal-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { getUserFacingError } from "@/lib/user-facing-error";
import { FixedAllocationDialog } from "@/components/fixed-allocation-dialog";
import { SupplierContractMeasurements } from "@/components/supplier-contract-measurements";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Company = { id: string; legal_name: string };
type SupplierContract = {
  id: string;
  supplier_id: string;
  description: string;
  billing_unit: "fixed" | "active_users" | "devices";
  billing_interval_months: 1 | 3 | 6 | 12;
  base_amount: number;
  unit_price: number;
  due_day: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  notes: string | null;
};
type Supplier = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  category: SupplierCategory;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  supplier_contracts: SupplierContract[];
};
type SupplierCategory =
  "software_licensing" | "datacenter" | "connectivity" | "professional_services" | "other";

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const categories: Array<{ value: SupplierCategory; label: string }> = [
  { value: "software_licensing", label: "Licenciamento de software" },
  { value: "datacenter", label: "Datacenter e cloud" },
  { value: "connectivity", label: "Conectividade" },
  { value: "professional_services", label: "Serviços profissionais" },
  { value: "other", label: "Outros" },
];
const units = [
  { value: "fixed", label: "Valor fixo" },
  { value: "active_users", label: "Por usuário ativo" },
  { value: "devices", label: "Por dispositivo" },
] as const;
const intervals = [
  { value: "1", label: "Mensal" },
  { value: "3", label: "Trimestral" },
  { value: "6", label: "Semestral" },
  { value: "12", label: "Anual" },
];

const contractSchema = z
  .object({
    description: z.string().trim().min(2, "Informe uma descrição.").max(250),
    billing_unit: z.enum(["fixed", "active_users", "devices"]),
    billing_interval_months: z.coerce.number().refine((v) => [1, 3, 6, 12].includes(v)),
    base_amount: z.coerce.number().min(0),
    unit_price: z.coerce.number().min(0),
    due_day: z.coerce.number().int().min(1).max(31),
    starts_at: z.string().min(1, "Informe o início da vigência."),
    ends_at: z.string(),
    notes: z.string().max(4000),
    is_active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.billing_unit === "fixed" && value.base_amount <= 0)
      ctx.addIssue({ code: "custom", path: ["base_amount"], message: "Informe o valor fixo." });
    if (value.billing_unit !== "fixed" && value.unit_price <= 0)
      ctx.addIssue({
        code: "custom",
        path: ["unit_price"],
        message: "Informe o valor por unidade.",
      });
    if (value.ends_at && value.ends_at < value.starts_at)
      ctx.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "A data final não pode anteceder o início.",
      });
  });
type ContractFormInput = z.input<typeof contractSchema>;
type ContractForm = z.output<typeof contractSchema>;

export function PayableSuppliers({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | SupplierCategory>("all");
  const [contractTarget, setContractTarget] = useState<{
    supplier: Supplier;
    contract?: SupplierContract;
  }>();
  const [allocationTarget, setAllocationTarget] = useState<{
    supplier: Supplier;
    contract: SupplierContract;
  }>();
  const companies = useQuery({
    queryKey: ["payable-operating-companies"],
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
  }, [companyId, companies.data]);
  const query = useQuery({
    queryKey: ["payable-suppliers", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const [suppliers, contracts] = await Promise.all([
        db
          .from("suppliers")
          .select(
            "id,legal_name,trade_name,tax_id,category,contact_name,email,phone,notes,is_active",
          )
          .is("deleted_at", null)
          .order("legal_name"),
        db
          .from("supplier_contracts")
          .select(
            "id,supplier_id,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at,is_active,notes",
          )
          .eq("operating_company_id", companyId)
          .is("deleted_at", null)
          .order("starts_at", { ascending: false }),
      ]);
      if (suppliers.error) throw suppliers.error;
      if (contracts.error) throw contracts.error;
      const contractRows = (contracts.data ?? []) as SupplierContract[];
      return (suppliers.data ?? []).map((supplier) => ({
        ...supplier,
        supplier_contracts: contractRows.filter((contract) => contract.supplier_id === supplier.id),
      })) as Supplier[];
    },
  });
  const rows = useMemo(
    () =>
      (query.data ?? []).filter((supplier) => {
        const term = search.trim().toLocaleLowerCase("pt-BR");
        return (
          (category === "all" || supplier.category === category) &&
          (!term ||
            `${supplier.legal_name} ${supplier.trade_name ?? ""} ${supplier.tax_id ?? ""}`
              .toLocaleLowerCase("pt-BR")
              .includes(term))
        );
      }),
    [category, query.data, search],
  );
  const contracts = (query.data ?? [])
    .flatMap((s) => s.supplier_contracts)
    .filter((c) => c.is_active);
  const monthlyFixed = contracts
    .filter((c) => c.billing_unit === "fixed")
    .reduce((sum, c) => sum + Number(c.base_amount) / c.billing_interval_months, 0);
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["payable-suppliers", companyId] });

  return (
    <section className="scroll-mt-4 space-y-3" aria-labelledby="supplier-contracts-title">
      <PageHeader
        title="Contratos de fornecedores"
        titleId="supplier-contracts-title"
        subtitle="Condições de fornecimento, medições e rateio de custos por cliente e contrato."
        icon={PackageSearch}
      />
      {companies.isLoading ? (
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
          description="Solicite ao administrador o vínculo financeiro com uma empresa operadora."
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(0,1fr))]">
            <Card>
              <CardContent className="p-4">
                <Label>Empresa operadora</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.data.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.legal_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
            <Metric
              label="Fornecedores ativos"
              value={String((query.data ?? []).filter((s) => s.is_active).length)}
            />
            <Metric label="Contratos ativos" value={String(contracts.length)} />
            <Metric label="Custo fixo mensal" value={money.format(monthlyFixed)} />
          </div>
          <Card>
            <CardHeader className="gap-3 border-b lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Contratos de fornecimento</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Consulte o compromisso recorrente por empresa e unidade de cobrança.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="pl-9 sm:w-64"
                    placeholder="Buscar fornecedor"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                  <SelectTrigger className="sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    {categories.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {query.isLoading ? (
                <LoadingState label="Carregando fornecedores…" />
              ) : query.isError ? (
                <ErrorState
                  title="Fornecedores indisponíveis"
                  description="Verifique seu acesso financeiro e tente novamente."
                  action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
                />
              ) : rows.length === 0 ? (
                <EmptyState
                  title="Nenhum fornecedor encontrado"
                  description={
                    search || category !== "all"
                      ? "Ajuste os filtros para ampliar a busca."
                      : "Cadastre o primeiro fornecedor recorrente desta empresa."
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Ações</TableHead>
                        <TableHead>Fornecedor</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Contratos</TableHead>
                        <TableHead>Contato</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((supplier) => (
                        <TableRow key={supplier.id}>
                          <TableCell>
                            <div className="flex gap-1">
                              {canEdit ? (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Adicionar contrato para ${supplier.legal_name}`}
                                  onClick={() => setContractTarget({ supplier })}
                                >
                                  <FilePlus2 className="size-4" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {supplier.trade_name || supplier.legal_name}
                            </div>
                            {supplier.trade_name ? (
                              <div className="max-w-64 truncate text-xs text-muted-foreground">
                                {supplier.legal_name}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {categories.find((c) => c.value === supplier.category)?.label}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {supplier.supplier_contracts.length ? (
                                supplier.supplier_contracts.map((contract) => (
                                  <div
                                    key={contract.id}
                                    className="flex max-w-xl items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                                  >
                                    <button
                                      className="min-w-0 flex-1 text-left text-xs hover:text-primary"
                                      onClick={() => setContractTarget({ supplier, contract })}
                                      title="Abrir cadastro e histórico de medições"
                                    >
                                      <span className="block truncate font-medium text-primary">
                                        {contract.description}
                                      </span>
                                      <span className="block text-muted-foreground">
                                        {contract.billing_unit === "fixed"
                                          ? money.format(contract.base_amount)
                                          : `${money.format(contract.unit_price)}/un.`}
                                        {" · "}
                                        {contract.ends_at
                                          ? `até ${new Date(`${contract.ends_at}T00:00:00`).toLocaleDateString("pt-BR")}`
                                          : "sem data final"}
                                      </span>
                                    </button>
                                    <Badge variant={contract.is_active ? "secondary" : "outline"}>
                                      {contract.is_active ? "Ativo" : "Inativo"}
                                    </Badge>
                                    {canEdit && contract.billing_unit === "fixed" ? (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="size-7 shrink-0"
                                        aria-label={`Configurar rateio de ${contract.description}`}
                                        title="Configurar rateio fixo"
                                        onClick={() => setAllocationTarget({ supplier, contract })}
                                      >
                                        <Percent className="size-3.5" />
                                      </Button>
                                    ) : null}
                                  </div>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Nenhum contrato
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {supplier.contact_name || "Não informado"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {supplier.email || supplier.phone || "Sem contato"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={supplier.is_active ? "secondary" : "outline"}>
                              {supplier.is_active ? "Ativo" : "Inativo"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {contractTarget ? (
        <ContractDialog
          companyId={companyId}
          target={contractTarget}
          canEdit={canEdit}
          onClose={() => setContractTarget(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {allocationTarget ? (
        <FixedAllocationDialog
          companyId={companyId}
          supplierName={
            allocationTarget.supplier.trade_name || allocationTarget.supplier.legal_name
          }
          contract={allocationTarget.contract}
          onClose={() => setAllocationTarget(undefined)}
          onSaved={refresh}
        />
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="mt-1 text-xs text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}

function ContractDialog({
  companyId,
  target,
  canEdit,
  onClose,
  onSaved,
}: {
  companyId: string;
  target: { supplier: Supplier; contract?: SupplierContract };
  canEdit: boolean;
  onClose(): void;
  onSaved(): void;
}) {
  const contract = target.contract;
  const form = useForm<ContractFormInput, unknown, ContractForm>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      description: contract?.description ?? "",
      billing_unit: contract?.billing_unit ?? "fixed",
      billing_interval_months: contract?.billing_interval_months ?? 1,
      base_amount: Number(contract?.base_amount ?? 0),
      unit_price: Number(contract?.unit_price ?? 0),
      due_day: contract?.due_day ?? 10,
      starts_at: contract?.starts_at ?? new Date().toISOString().slice(0, 10),
      ends_at: contract?.ends_at ?? "",
      notes: contract?.notes ?? "",
      is_active: contract?.is_active ?? true,
    },
  });
  const unit = form.watch("billing_unit");
  const save = useMutation({
    mutationFn: async (value: ContractForm) => {
      const payload = {
        ...value,
        billing_interval_months: value.billing_interval_months,
        base_amount: value.billing_unit === "fixed" ? value.base_amount : 0,
        unit_price: value.billing_unit === "fixed" ? 0 : value.unit_price,
        ends_at: value.ends_at || null,
        notes: value.notes || null,
      };
      if (contract) {
        const { data, error } = await db
          .from("supplier_contracts")
          .update(payload)
          .eq("id", contract.id)
          .eq("operating_company_id", companyId)
          .select("id")
          .maybeSingle();
        if (error || !data) throw error ?? new Error("Contrato não encontrado ou sem permissão.");
      } else {
        const tenantId = await getMyTenantId();
        if (!tenantId) throw new Error("Tenant não encontrada.");
        const { error } = await db.from("supplier_contracts").insert({
          ...payload,
          tenant_id: tenantId,
          operating_company_id: companyId,
          supplier_id: target.supplier.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(contract ? "Contrato atualizado" : "Contrato cadastrado");
      onSaved();
      onClose();
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível salvar o contrato.")),
  });
  const archive = useMutation({
    mutationFn: async () => {
      if (!contract) return;
      const { data, error } = await db
        .from("supplier_contracts")
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq("id", contract.id)
        .select("id")
        .maybeSingle();
      if (error || !data) throw error ?? new Error("Contrato não encontrado.");
    },
    onSuccess: () => {
      toast.success("Contrato arquivado");
      onSaved();
      onClose();
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível arquivar o contrato.")),
  });
  const errors = form.formState.errors;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {contract ? "Editar contrato de fornecimento" : "Novo contrato de fornecimento"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Fornecedor: {target.supplier.trade_name || target.supplier.legal_name}
          </p>
        </DialogHeader>
        <Tabs defaultValue="registration">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="registration">Cadastro</TabsTrigger>
            <TabsTrigger value="measurements" disabled={!contract}>
              Histórico de medições
            </TabsTrigger>
          </TabsList>
          <TabsContent value="registration" className="pt-4">
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={form.handleSubmit((v) => save.mutate(v))}
            >
              <div className="sm:col-span-2">
                <Label htmlFor="contract-description">Descrição</Label>
                <Input
                  id="contract-description"
                  disabled={!canEdit}
                  {...form.register("description")}
                />
                <FieldError message={errors.description?.message} />
              </div>
              <div>
                <Label>Unidade de cobrança</Label>
                <Select
                  disabled={!canEdit}
                  value={unit}
                  onValueChange={(v) =>
                    form.setValue("billing_unit", v as ContractForm["billing_unit"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Periodicidade</Label>
                <Select
                  disabled={!canEdit}
                  value={String(form.watch("billing_interval_months"))}
                  onValueChange={(v) => form.setValue("billing_interval_months", Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {intervals.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="contract-price">
                  {unit === "fixed" ? "Valor do período" : "Valor por unidade"}
                </Label>
                <FinancialCurrencyInput
                  id="contract-price"
                  disabled={!canEdit}
                  value={form.watch(unit === "fixed" ? "base_amount" : "unit_price")}
                  onValueChange={(value) =>
                    form.setValue(
                      unit === "fixed" ? "base_amount" : "unit_price",
                      Number(value || 0),
                      {
                        shouldDirty: true,
                        shouldValidate: true,
                      },
                    )
                  }
                />
                <FieldError
                  message={
                    unit === "fixed" ? errors.base_amount?.message : errors.unit_price?.message
                  }
                />
              </div>
              <div>
                <Label htmlFor="contract-due">Dia do vencimento</Label>
                <Input
                  id="contract-due"
                  type="number"
                  min="1"
                  max="31"
                  disabled={!canEdit}
                  {...form.register("due_day")}
                />
                <FieldError message={errors.due_day?.message} />
              </div>
              <div>
                <Label htmlFor="contract-start">Início</Label>
                <Input
                  id="contract-start"
                  type="date"
                  disabled={!canEdit}
                  {...form.register("starts_at")}
                />
              </div>
              <div>
                <Label htmlFor="contract-end">Fim opcional</Label>
                <Input
                  id="contract-end"
                  type="date"
                  disabled={!canEdit}
                  {...form.register("ends_at")}
                />
                <FieldError message={errors.ends_at?.message} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="contract-notes">Observações</Label>
                <Textarea id="contract-notes" disabled={!canEdit} {...form.register("notes")} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  disabled={!canEdit}
                  checked={form.watch("is_active")}
                  onCheckedChange={(v) => form.setValue("is_active", v)}
                />
                Contrato ativo
              </label>
              <DialogFooter className="sm:col-span-2 sm:justify-between">
                <div>
                  {contract && canEdit ? (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={archive.isPending}
                      onClick={() => archive.mutate()}
                    >
                      Arquivar
                    </Button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Fechar
                  </Button>
                  {canEdit ? (
                    <Button type="submit" disabled={save.isPending}>
                      {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}Salvar
                      contrato
                    </Button>
                  ) : null}
                </div>
              </DialogFooter>
            </form>
          </TabsContent>
          <TabsContent value="measurements" className="pt-4">
            {contract ? (
              <SupplierContractMeasurements
                contract={contract}
                supplierName={target.supplier.trade_name || target.supplier.legal_name}
                canGenerate={canEdit && target.supplier.is_active && contract.is_active}
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
