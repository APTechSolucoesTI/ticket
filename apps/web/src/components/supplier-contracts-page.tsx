import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Eye, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { getUserFacingError, getValidationErrorMessage } from "@/lib/user-facing-error";
import { formatCurrency } from "@/lib/number-format";
import { PageHeader, EmptyStub } from "@/components/empty-stub";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import { SupplierContractMeasurements } from "@/components/supplier-contract-measurements";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FinancialCurrencyInput } from "@/components/ui/decimal-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FinancialDimensionFields } from "@/components/financial-dimension-fields";
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

type BillingUnit = "fixed" | "active_users" | "devices";
type ContractStatus = "active" | "suspended" | "expired" | "cancelled";
type MeasurementFrequency = "mensal" | "trimestral" | "semestral" | "anual" | "unica";
type DueType = "fixo" | "util";
type Company = { id: string; legal_name: string; trade_name: string | null };
type Supplier = { id: string; legal_name: string; trade_name: string | null; is_active: boolean };
type Contract = {
  id: string;
  tenant_id: string;
  operating_company_id: string;
  supplier_id: string;
  numero_contrato: string;
  description: string;
  billing_unit: BillingUnit;
  billing_interval_months: 1 | 3 | 6 | 12;
  base_amount: number;
  unit_price: number;
  due_day: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  status: ContractStatus;
  tipo_medicao: MeasurementFrequency;
  tipo_vencimento: DueType;
  emite_nf: boolean;
  emite_boleto: boolean;
  auto_renew: boolean;
  notes: string | null;
  financial_category_id: string | null;
  cost_center_id: string | null;
  financial_categories?: { code: string; name: string } | null;
  financial_cost_centers?: { code: string; name: string } | null;
  supplier_name: string;
  operator_name: string;
};

type FormState = Omit<
  Contract,
  | "id"
  | "tenant_id"
  | "supplier_name"
  | "operator_name"
  | "is_active"
  | "ends_at"
  | "notes"
  | "financial_category_id"
  | "cost_center_id"
  | "financial_categories"
  | "financial_cost_centers"
> & { ends_at: string; notes: string; financial_category_id: string; cost_center_id: string };

const db = supabase as unknown as SupabaseClient;
const DAY = 86_400_000;
const statusLabel: Record<ContractStatus, string> = {
  active: "Ativo",
  suspended: "Suspenso",
  expired: "Expirado",
  cancelled: "Cancelado",
};
const unitLabel: Record<BillingUnit, string> = {
  fixed: "Valor fixo",
  active_users: "Por usuário ativo",
  devices: "Por equipamento",
};
const frequencyMonths: Record<Exclude<MeasurementFrequency, "unica">, 1 | 3 | 6 | 12> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};
const schema = z
  .object({
    operating_company_id: z.string().uuid("Selecione a empresa operadora."),
    supplier_id: z.string().uuid("Selecione o fornecedor."),
    description: z.string().trim().min(2, "Informe a descrição.").max(250),
    billing_unit: z.enum(["fixed", "active_users", "devices"]),
    base_amount: z.number().min(0),
    unit_price: z.number().min(0),
    due_day: z.number().int().min(1).max(31),
    starts_at: z.string().min(1, "Informe o início."),
    ends_at: z.string().min(1, "Informe o fim."),
    status: z.enum(["active", "suspended", "expired", "cancelled"]),
    tipo_medicao: z.enum(["mensal", "trimestral", "semestral", "anual", "unica"]),
    tipo_vencimento: z.enum(["fixo", "util"]),
    emite_nf: z.boolean(),
    emite_boleto: z.boolean(),
    auto_renew: z.boolean(),
    notes: z.string().max(4000),
    financial_category_id: z.string().uuid().nullable(),
    cost_center_id: z.string().uuid().nullable(),
  })
  .superRefine((value, context) => {
    if (value.ends_at < value.starts_at)
      context.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "O fim deve ser posterior ao início.",
      });
    if (value.billing_unit === "fixed" && value.base_amount <= 0)
      context.addIssue({
        code: "custom",
        path: ["base_amount"],
        message: "Informe o valor do contrato.",
      });
    if (value.billing_unit !== "fixed" && value.unit_price <= 0)
      context.addIssue({
        code: "custom",
        path: ["unit_price"],
        message: "Informe o valor unitário.",
      });
    if (Boolean(value.financial_category_id) !== Boolean(value.cost_center_id))
      context.addIssue({
        code: "custom",
        path: ["financial_category_id"],
        message: "Selecione a categoria financeira e o centro de custo em conjunto.",
      });
  });

function endingSoon(value: string | null) {
  if (!value) return false;
  const end = Date.parse(`${value}T00:00:00Z`);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return end >= today && (end - today) / DAY <= 30;
}

function formatDate(value: string | null) {
  return value
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })
    : "Não informado";
}

export function SupplierContractsPage({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [toDelete, setToDelete] = useState<Contract | null>(null);
  const options = useQuery({
    queryKey: ["supplier-contract-options"],
    queryFn: async () => {
      const [companies, suppliers] = await Promise.all([
        db
          .from("operating_companies")
          .select("id,legal_name,trade_name")
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("legal_name"),
        db
          .from("suppliers")
          .select("id,legal_name,trade_name,is_active")
          .is("deleted_at", null)
          .order("legal_name"),
      ]);
      if (companies.error) throw companies.error;
      if (suppliers.error) throw suppliers.error;
      return {
        companies: (companies.data ?? []) as Company[],
        suppliers: (suppliers.data ?? []) as Supplier[],
      };
    },
  });
  const contracts = useQuery({
    queryKey: ["supplier-contracts"],
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_contracts")
        .select(
          "id,tenant_id,operating_company_id,supplier_id,numero_contrato,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at,is_active,status,tipo_medicao,tipo_vencimento,emite_nf,emite_boleto,auto_renew,notes,financial_category_id,cost_center_id,financial_categories(code,name),financial_cost_centers(code,name)",
        )
        .is("deleted_at", null)
        .order("starts_at", { ascending: false });
      if (error) throw error;
      const supplierNames = new Map(
        (options.data?.suppliers ?? []).map((item) => [
          item.id,
          item.trade_name || item.legal_name,
        ]),
      );
      const operatorNames = new Map(
        (options.data?.companies ?? []).map((item) => [
          item.id,
          item.trade_name || item.legal_name,
        ]),
      );
      return (data ?? []).map((item) => ({
        ...item,
        supplier_name: supplierNames.get(item.supplier_id as string) ?? "Fornecedor",
        operator_name:
          operatorNames.get(item.operating_company_id as string) ?? "Empresa operadora",
      })) as unknown as Contract[];
    },
    enabled: options.isSuccess,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("archive_supplier_contract", { p_contract_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contrato removido");
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["supplier-contracts"] });
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível remover o contrato.")),
  });
  const columns: ListColumn<Contract>[] = [
    {
      key: "number",
      label: "Contrato",
      accessor: (row) => row.numero_contrato,
      cell: (row) => row.numero_contrato,
      className: "font-mono text-xs font-semibold",
    },
    {
      key: "operator",
      label: "Empresa operadora",
      accessor: (row) => row.operator_name,
      cell: (row) => row.operator_name,
    },
    {
      key: "supplier",
      label: "Fornecedor",
      accessor: (row) => row.supplier_name,
      cell: (row) => <span className="font-medium">{row.supplier_name}</span>,
    },
    {
      key: "billing",
      label: "Cobrança",
      accessor: (row) => unitLabel[row.billing_unit],
      cell: (row) => unitLabel[row.billing_unit],
    },
    {
      key: "measurement",
      label: "Medição",
      accessor: (row) => row.tipo_medicao,
      cell: (row) => row.tipo_medicao[0].toUpperCase() + row.tipo_medicao.slice(1),
    },
    {
      key: "category",
      label: "Categoria financeira",
      accessor: (row) => row.financial_categories?.name ?? "",
      cell: (row) =>
        row.financial_categories
          ? `${row.financial_categories.code} - ${row.financial_categories.name}`
          : "-",
    },
    {
      key: "cost_center",
      label: "Centro de custo",
      accessor: (row) => row.financial_cost_centers?.name ?? "",
      cell: (row) =>
        row.financial_cost_centers
          ? `${row.financial_cost_centers.code} - ${row.financial_cost_centers.name}`
          : "-",
    },
    {
      key: "end",
      label: "Data Fim do Contrato",
      accessor: (row) => row.ends_at ?? "",
      cell: (row) => (
        <span className={endingSoon(row.ends_at) ? "font-bold text-destructive" : undefined}>
          {formatDate(row.ends_at)}
        </span>
      ),
    },
    {
      key: "value",
      label: "Valor",
      accessor: (row) => (row.billing_unit === "fixed" ? row.base_amount : row.unit_price),
      cell: (row) =>
        formatCurrency(row.billing_unit === "fixed" ? row.base_amount : row.unit_price),
      className: "text-right tabular-nums",
    },
    {
      key: "status",
      label: "Status",
      accessor: (row) => row.status,
      cell: (row) => (
        <Badge variant={row.status === "active" ? "secondary" : "outline"}>
          {statusLabel[row.status]}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "Ações",
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {canEdit ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Editar contrato ${row.numero_contrato}`}
                onClick={() => {
                  setEditing(row);
                  setOpen(true);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remover contrato ${row.numero_contrato}`}
                onClick={() => setToDelete(row)}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Visualizar contrato ${row.numero_contrato}`}
              onClick={() => {
                setEditing(row);
                setOpen(true);
              }}
            >
              <Eye className="size-4" />
            </Button>
          )}
        </div>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Contratos de fornecedores"
        subtitle="Condições de fornecimento, vigência, medições e custos por contrato de cliente."
        icon={FileText}
        actions={
          canEdit ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-1 size-4" /> Novo contrato
            </Button>
          ) : undefined
        }
      />
      {contracts.isLoading || options.isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : contracts.isError || options.isError ? (
        <EmptyStub
          title="Contratos indisponíveis"
          message="Não foi possível consultar os contratos de fornecedores."
        />
      ) : !contracts.data?.length ? (
        <EmptyStub
          title="Nenhum contrato registrado"
          message="Cadastre o primeiro contrato de fornecedor para iniciar as medições e o acompanhamento de custos."
        />
      ) : (
        <Card className="p-3">
          <ConfigurableTable
            listKey="supplier-contracts"
            rows={contracts.data}
            rowKey={(row) => row.id}
            defaultColumns={[
              "number",
              "operator",
              "supplier",
              "billing",
              "measurement",
              "category",
              "cost_center",
              "end",
              "value",
              "status",
              "actions",
            ]}
            columns={columns}
          />
        </Card>
      )}
      <SupplierContractDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        canEdit={canEdit}
        companies={options.data?.companies ?? []}
        suppliers={options.data?.suppliers ?? []}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ["supplier-contracts"] })}
      />
      <AlertDialog open={Boolean(toDelete)} onOpenChange={(value) => !value && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              O contrato será removido somente se ainda não possuir medições. Esta ação não pode ser
              desfeita pela interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => toDelete && remove.mutate(toDelete.id)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SupplierContractDialog({
  open,
  onOpenChange,
  editing,
  canEdit,
  companies,
  suppliers,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  editing: Contract | null;
  canEdit: boolean;
  companies: Company[];
  suppliers: Supplier[];
  onSaved(): void;
}) {
  const [form, setForm] = useState<FormState>({
    operating_company_id: "",
    supplier_id: "",
    numero_contrato: "",
    description: "",
    billing_unit: "fixed",
    billing_interval_months: 1,
    base_amount: 0,
    unit_price: 0,
    due_day: 10,
    starts_at: "",
    ends_at: "",
    status: "active",
    tipo_medicao: "mensal",
    tipo_vencimento: "fixo",
    emite_nf: false,
    emite_boleto: false,
    auto_renew: true,
    notes: "",
    financial_category_id: "",
    cost_center_id: "",
  });
  useEffect(() => {
    if (!open) return;
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(today.getFullYear() + 1);
    setForm({
      operating_company_id: editing?.operating_company_id ?? companies[0]?.id ?? "",
      supplier_id: editing?.supplier_id ?? "",
      numero_contrato: editing?.numero_contrato ?? "",
      description: editing?.description ?? "",
      billing_unit: editing?.billing_unit ?? "fixed",
      billing_interval_months: editing?.billing_interval_months ?? 1,
      base_amount: Number(editing?.base_amount ?? 0),
      unit_price: Number(editing?.unit_price ?? 0),
      due_day: editing?.due_day ?? 10,
      starts_at: editing?.starts_at ?? today.toISOString().slice(0, 10),
      ends_at: editing?.ends_at ?? nextYear.toISOString().slice(0, 10),
      status: editing?.status ?? "active",
      tipo_medicao: editing?.tipo_medicao ?? "mensal",
      tipo_vencimento: editing?.tipo_vencimento ?? "fixo",
      emite_nf: editing?.emite_nf ?? false,
      emite_boleto: editing?.emite_boleto ?? false,
      auto_renew: editing?.auto_renew ?? true,
      notes: editing?.notes ?? "",
      financial_category_id: editing?.financial_category_id ?? "",
      cost_center_id: editing?.cost_center_id ?? "",
    });
  }, [companies, editing, open]);
  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse({
        ...form,
        financial_category_id: form.financial_category_id || null,
        cost_center_id: form.cost_center_id || null,
      });
      if (!parsed.success) throw new Error(getValidationErrorMessage(parsed.error));
      const frequency =
        parsed.data.tipo_medicao === "unica" ? 1 : frequencyMonths[parsed.data.tipo_medicao];
      const values = {
        ...parsed.data,
        billing_interval_months: frequency,
        base_amount: parsed.data.billing_unit === "fixed" ? parsed.data.base_amount : 0,
        unit_price: parsed.data.billing_unit === "fixed" ? 0 : parsed.data.unit_price,
        notes: parsed.data.notes || null,
        is_active: parsed.data.status === "active",
      };
      if (editing) {
        const { operating_company_id: _operator, supplier_id: _supplier, ...mutable } = values;
        const { error } = await db.from("supplier_contracts").update(mutable).eq("id", editing.id);
        if (error) throw error;
      } else {
        const tenantId = await getMyTenantId();
        if (!tenantId) throw new Error("Tenant não encontrada.");
        const { error } = await db
          .from("supplier_contracts")
          .insert({ ...values, tenant_id: tenantId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Contrato atualizado" : "Contrato criado");
      onSaved();
      onOpenChange(false);
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível salvar o contrato.")),
  });
  const readOnly = !canEdit;
  const setFrequency = (value: MeasurementFrequency) =>
    setForm((current) => ({
      ...current,
      tipo_medicao: value,
      billing_interval_months: value === "unica" ? 1 : frequencyMonths[value],
    }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto text-xs sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {readOnly ? "Visualizar contrato" : editing ? "Editar contrato" : "Novo contrato"}
          </DialogTitle>
        </DialogHeader>
        <Tabs key={editing?.id ?? "new"} defaultValue="registration">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="registration">Cadastro</TabsTrigger>
            <TabsTrigger value="measurements" disabled={!editing}>
              Histórico de Medições
            </TabsTrigger>
          </TabsList>
          <TabsContent value="registration">
            <form
              className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4 [&_label]:text-[11px] [&_input]:h-8 [&_input]:text-xs [&_button[role=combobox]]:h-8 [&_button[role=combobox]]:text-xs"
              onSubmit={(event) => {
                event.preventDefault();
                if (!readOnly) save.mutate();
              }}
            >
              <div>
                <Label>Número do contrato</Label>
                <Input
                  value={form.numero_contrato}
                  placeholder="Gerado automaticamente"
                  readOnly
                  className="font-mono"
                />
              </div>
              <div>
                <Label>Tipo de medição *</Label>
                <Select
                  value={form.tipo_medicao}
                  onValueChange={(value) => setFrequency(value as MeasurementFrequency)}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mensal">Mensal</SelectItem>
                    <SelectItem value="trimestral">Trimestral</SelectItem>
                    <SelectItem value="semestral">Semestral</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                    <SelectItem value="unica">Única</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Dia do vencimento *</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={form.due_day}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, due_day: Number(event.target.value) })}
                />
              </div>
              <fieldset className="rounded-md border px-3 py-2">
                <legend className="px-1 text-[11px] font-medium">Regra de vencimento</legend>
                <RadioGroup
                  value={form.tipo_vencimento}
                  onValueChange={(value) => setForm({ ...form, tipo_vencimento: value as DueType })}
                  disabled={readOnly}
                  className="grid grid-cols-2 gap-3"
                >
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="fixo" /> Fixo
                  </label>
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="util" /> Útil
                  </label>
                </RadioGroup>
              </fieldset>
              <p className="text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-4">
                A data de vencimento será calculada em cada medição conforme a regra e o dia
                informados.
              </p>
              <label className="flex items-center justify-between rounded-md border px-3 py-2 lg:col-span-2">
                <span>
                  <span className="block font-medium">Exigir nota fiscal</span>
                  <span className="text-[10px] text-muted-foreground">
                    Registra a exigência na medição.
                  </span>
                </span>
                <Switch
                  checked={form.emite_nf}
                  onCheckedChange={(value) => setForm({ ...form, emite_nf: value })}
                  disabled={readOnly}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border px-3 py-2 lg:col-span-2">
                <span>
                  <span className="block font-medium">Pagamento bancário</span>
                  <span className="text-[10px] text-muted-foreground">
                    Registra a previsão financeira.
                  </span>
                </span>
                <Switch
                  checked={form.emite_boleto}
                  onCheckedChange={(value) => setForm({ ...form, emite_boleto: value })}
                  disabled={readOnly}
                />
              </label>
              <div className="lg:col-span-4">
                <Label>Empresa operadora *</Label>
                <Select
                  value={form.operating_company_id}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      operating_company_id: value,
                      financial_category_id: "",
                      cost_center_id: "",
                    })
                  }
                  disabled={readOnly || Boolean(editing)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.trade_name || company.legal_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="lg:col-span-4">
                <FinancialDimensionFields
                  companyId={form.operating_company_id}
                  direction="outflow"
                  categoryId={form.financial_category_id}
                  costCenterId={form.cost_center_id}
                  onCategoryChange={(value) =>
                    setForm((current) => ({ ...current, financial_category_id: value }))
                  }
                  onCostCenterChange={(value) =>
                    setForm((current) => ({ ...current, cost_center_id: value }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="lg:col-span-4">
                <Label>Fornecedor *</Label>
                <Select
                  value={form.supplier_id}
                  onValueChange={(value) => setForm({ ...form, supplier_id: value })}
                  disabled={readOnly || Boolean(editing)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers
                      .filter((supplier) => supplier.is_active || supplier.id === form.supplier_id)
                      .map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.trade_name || supplier.legal_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Modelo de cobrança *</Label>
                <Select
                  value={form.billing_unit}
                  onValueChange={(value) =>
                    setForm({ ...form, billing_unit: value as BillingUnit })
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Valor fixo</SelectItem>
                    <SelectItem value="active_users">Por usuário ativo</SelectItem>
                    <SelectItem value="devices">Por equipamento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => setForm({ ...form, status: value as ContractStatus })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusLabel).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Início *</Label>
                <Input
                  type="date"
                  value={form.starts_at}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
                />
              </div>
              <div>
                <Label>Fim *</Label>
                <Input
                  type="date"
                  value={form.ends_at}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, ends_at: event.target.value })}
                />
              </div>
              <div className="lg:col-span-3">
                <Label>
                  {form.billing_unit === "fixed" ? "Valor do contrato (R$)" : "Valor unitário (R$)"}
                </Label>
                <FinancialCurrencyInput
                  value={form.billing_unit === "fixed" ? form.base_amount : form.unit_price}
                  disabled={readOnly}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      [form.billing_unit === "fixed" ? "base_amount" : "unit_price"]: Number(
                        value || 0,
                      ),
                    })
                  }
                />
              </div>
              <label className="flex h-[52px] items-center justify-between rounded-md border px-3">
                <span>Renovação auto.</span>
                <Switch
                  checked={form.auto_renew}
                  onCheckedChange={(value) => setForm({ ...form, auto_renew: value })}
                  disabled={readOnly}
                />
              </label>
              <div className="lg:col-span-4">
                <Label>Descrição do contrato</Label>
                <Textarea
                  rows={3}
                  value={form.description}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </div>
              <div className="lg:col-span-4">
                <Label>Observações</Label>
                <RichTextEditor
                  value={form.notes}
                  onChange={(notes) => setForm({ ...form, notes })}
                />
              </div>
              <DialogFooter className="lg:col-span-4">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  {readOnly ? "Fechar" : "Cancelar"}
                </Button>
                {!readOnly ? (
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? "Salvando…" : "Salvar"}
                  </Button>
                ) : null}
              </DialogFooter>
            </form>
          </TabsContent>
          <TabsContent value="measurements">
            {editing ? (
              <SupplierContractMeasurements
                contract={editing}
                supplierName={editing.supplier_name}
                canGenerate={canEdit && editing.status === "active"}
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
