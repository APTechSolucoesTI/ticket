import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarDays, Calculator, Loader2, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useFinancialDocumentTypes } from "@/hooks/use-financial-document-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FinancialCurrencyInput } from "@/components/ui/decimal-input";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";
import { FinancialDimensionFields } from "@/components/financial-dimension-fields";

const db = supabase as unknown as SupabaseClient;
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const schema = z
  .object({
    operatingCompanyId: z.string().uuid("Selecione a empresa operadora."),
    counterpartyId: z.string().uuid("Selecione o cliente ou fornecedor."),
    documentTypeId: z.string().uuid("Selecione o tipo de documento."),
    document: z.string().trim().min(2, "Informe o número do documento.").max(80),
    description: z.string().trim().min(2, "Informe a descrição.").max(500),
    competence: z.string().regex(/^\d{4}-\d{2}$/, "Informe a competência."),
    totalAmount: z
      .string()
      .refine((value) => Number(value) > 0, "O valor deve ser maior que zero.")
      .refine((value) => Number(value) <= 999_999_999.99, "O valor máximo é R$ 999.999.999,99."),
    entryMode: z.enum(["single", "installments"]),
    dueDate: z.string(),
    installmentCount: z.number().int().min(2).max(120),
    intervalDays: z.number().int().min(1).max(3650),
    firstDueDate: z.string(),
    installments: z.array(
      z.object({
        number: z.number().int().positive(),
        dueDate: z.string(),
        amount: z.string(),
      }),
    ),
    notes: z.string().trim().max(4000, "Use no máximo 4.000 caracteres."),
    financialCategoryId: z.string(),
    costCenterId: z.string(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.financialCategoryId) !== Boolean(value.costCenterId))
      context.addIssue({
        code: "custom",
        path: ["financialCategoryId"],
        message: "Selecione a categoria financeira e o centro de custo em conjunto.",
      });
    const competenceStart = `${value.competence}-01`;
    if (value.entryMode === "installments" && value.document.trim().length > 70) {
      context.addIssue({
        code: "custom",
        path: ["document"],
        message:
          "No parcelamento, use no máximo 70 caracteres para permitir a identificação da parcela.",
      });
    }
    if (value.entryMode === "single") {
      if (!value.dueDate)
        context.addIssue({ code: "custom", path: ["dueDate"], message: "Informe o vencimento." });
      else if (value.dueDate < competenceStart)
        context.addIssue({
          code: "custom",
          path: ["dueDate"],
          message: "O vencimento não pode anteceder a competência.",
        });
    } else if (!value.firstDueDate) {
      context.addIssue({
        code: "custom",
        path: ["firstDueDate"],
        message: "Informe o primeiro vencimento.",
      });
    } else if (value.firstDueDate < competenceStart) {
      context.addIssue({
        code: "custom",
        path: ["firstDueDate"],
        message: "O primeiro vencimento não pode anteceder a competência.",
      });
    }
  });

type FormValues = z.input<typeof schema>;
type Direction = "receivable" | "payable";
type Option = { id: string; label: string };

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function toCents(value: string | number) {
  return Math.round(Number(value) * 100);
}
function fromCents(value: number) {
  return (value / 100).toFixed(2);
}
function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

function ManualEntryDialog({
  direction,
  open,
  operatingCompanyId,
  onClose,
  onCreated,
}: {
  direction: Direction;
  open: boolean;
  operatingCompanyId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isReceivable = direction === "receivable";
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      operatingCompanyId: operatingCompanyId ?? "",
      counterpartyId: "",
      documentTypeId: "",
      document: "",
      description: "",
      competence: currentMonth(),
      totalAmount: "",
      entryMode: "single",
      dueDate: today(),
      installmentCount: 2,
      intervalDays: 30,
      firstDueDate: today(),
      installments: [],
      notes: "",
      financialCategoryId: "",
      costCenterId: "",
    },
  });
  const { fields, replace } = useFieldArray({ control: form.control, name: "installments" });
  const [scheduleSignature, setScheduleSignature] = useState("");
  const documentTypes = useFinancialDocumentTypes(open);
  const entryMode = useWatch({ control: form.control, name: "entryMode" });
  const competence = useWatch({ control: form.control, name: "competence" });
  const totalAmount = useWatch({ control: form.control, name: "totalAmount" });
  const installmentCount = useWatch({ control: form.control, name: "installmentCount" });
  const intervalDays = useWatch({ control: form.control, name: "intervalDays" });
  const firstDueDate = useWatch({ control: form.control, name: "firstDueDate" });
  const selectedCompanyId = useWatch({ control: form.control, name: "operatingCompanyId" });
  const selectedCategoryId = useWatch({ control: form.control, name: "financialCategoryId" });
  const selectedCostCenterId = useWatch({ control: form.control, name: "costCenterId" });
  const installmentValues = useWatch({ control: form.control, name: "installments" }) ?? [];
  const currentSignature = `${totalAmount}|${installmentCount}|${intervalDays}|${firstDueDate}|${competence}`;
  const distributedCents = installmentValues.reduce((sum, item) => sum + toCents(item.amount), 0);
  const totalCents = toCents(totalAmount);
  const scheduleIsCurrent = fields.length > 0 && scheduleSignature === currentSignature;

  const companies = useQuery({
    queryKey: ["manual-entry-operating-companies"],
    enabled: open && isReceivable,
    queryFn: async () => {
      const { data, error } = await db
        .from("operating_companies")
        .select("id,legal_name")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []).map((item) => ({ id: item.id, label: item.legal_name })) as Option[];
    },
  });
  const counterparties = useQuery({
    queryKey: ["manual-entry-counterparties", direction],
    enabled: open,
    queryFn: async () => {
      if (isReceivable) {
        const { data, error } = await db.from("companies").select("id,name").order("name");
        if (error) throw error;
        return (data ?? []).map((item) => ({ id: item.id, label: item.name })) as Option[];
      }
      const { data, error } = await db
        .from("suppliers")
        .select("id,legal_name,trade_name")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []).map((item) => ({
        id: item.id,
        label: item.trade_name || item.legal_name,
      })) as Option[];
    },
  });
  const availableDocumentTypes = useMemo(
    () =>
      (documentTypes.data ?? []).filter(
        (item) =>
          item.is_active && (item.availability === direction || item.availability === "both"),
      ),
    [direction, documentTypes.data],
  );

  useEffect(() => {
    if (open && isReceivable && companies.data?.length === 1)
      form.setValue("operatingCompanyId", companies.data[0].id, { shouldValidate: true });
  }, [companies.data, form, isReceivable, open]);
  useEffect(() => {
    if (open && operatingCompanyId) form.setValue("operatingCompanyId", operatingCompanyId);
  }, [form, open, operatingCompanyId]);
  useEffect(() => {
    if (open && availableDocumentTypes.length === 1)
      form.setValue("documentTypeId", availableDocumentTypes[0].id, { shouldValidate: true });
  }, [availableDocumentTypes, form, open]);
  useEffect(() => {
    if (open) return;
    form.reset();
    replace([]);
    setScheduleSignature("");
  }, [form, open, replace]);

  function generateInstallments() {
    form.clearErrors("root.installments");
    const count = Number(installmentCount);
    const days = Number(intervalDays);
    if (!Number.isInteger(count) || count < 2 || count > 120) {
      form.setError("installmentCount", { message: "Informe de 2 a 120 parcelas." });
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      form.setError("intervalDays", { message: "Informe um intervalo válido em dias." });
      return;
    }
    if (!firstDueDate) {
      form.setError("firstDueDate", { message: "Informe o primeiro vencimento." });
      return;
    }
    if (totalCents <= 0) {
      form.setError("totalAmount", {
        message: "Informe o valor total antes de gerar as parcelas.",
      });
      return;
    }
    const base = Math.floor(totalCents / count);
    const remainder = totalCents - base * count;
    if (base === 0) {
      form.setError("installmentCount", {
        message: "O valor deve permitir parcelas de ao menos R$ 0,01.",
      });
      return;
    }
    replace(
      Array.from({ length: count }, (_, index) => ({
        number: index + 1,
        dueDate: addDays(firstDueDate, index * days),
        amount: fromCents(base + (index < remainder ? 1 : 0)),
      })),
    );
    setScheduleSignature(currentSignature);
  }

  const create = useMutation({
    mutationFn: async (values: FormValues) => {
      const parsed = schema.parse(values);
      const installments =
        parsed.entryMode === "single"
          ? [{ number: 1, due_date: parsed.dueDate, amount: Number(parsed.totalAmount) }]
          : parsed.installments.map((item) => ({
              number: item.number,
              due_date: item.dueDate,
              amount: Number(item.amount),
            }));
      if (parsed.entryMode === "installments") {
        if (!scheduleIsCurrent || installments.length !== Number(parsed.installmentCount))
          throw new Error(
            "Recalcule as parcelas após alterar o valor, a quantidade, o intervalo ou o primeiro vencimento.",
          );
        if (installments.some((item) => !item.due_date || toCents(item.amount) <= 0))
          throw new Error("Revise os vencimentos e valores de todas as parcelas.");
        if (installments.some((item) => item.due_date < `${parsed.competence}-01`))
          throw new Error("O vencimento das parcelas não pode anteceder a competência.");
        if (
          installments.reduce((sum, item) => sum + toCents(item.amount), 0) !==
          toCents(parsed.totalAmount)
        )
          throw new Error(
            "A soma das parcelas deve ser exatamente igual ao valor total do documento.",
          );
      }
      const common = {
        p_operating_company_id: parsed.operatingCompanyId,
        p_document_type_id: parsed.documentTypeId,
        p_description: parsed.description,
        p_competence: `${parsed.competence}-01`,
        p_total_amount: Number(parsed.totalAmount),
        p_installments: installments,
        p_installment_interval_days:
          parsed.entryMode === "installments" ? Number(parsed.intervalDays) : 0,
        p_notes: parsed.notes || null,
        p_category_id: parsed.financialCategoryId || null,
        p_cost_center_id: parsed.costCenterId || null,
      };
      const { data, error } = isReceivable
        ? await db.rpc("create_manual_receivable_classified", {
            ...common,
            p_company_id: parsed.counterpartyId,
            p_document_reference: parsed.document,
          })
        : await db.rpc("create_manual_supplier_payable_classified", {
            ...common,
            p_supplier_id: parsed.counterpartyId,
            p_document_number: parsed.document,
          });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(
        entryMode === "installments"
          ? `${installmentCount} parcelas incluídas com sucesso.`
          : `${isReceivable ? "Conta a receber" : "Conta a pagar"} incluída com sucesso.`,
      );
      form.reset();
      replace([]);
      setScheduleSignature("");
      onCreated();
      onClose();
    },
    onError: (error) =>
      toast.error(
        getUserFacingError(
          error,
          `Não foi possível incluir ${isReceivable ? "a conta a receber" : "a conta a pagar"}.`,
        ),
      ),
  });
  const loadError = companies.isError || counterparties.isError || documentTypes.isError;
  const loadPending =
    counterparties.isLoading || documentTypes.isLoading || (isReceivable && companies.isLoading);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="size-5 text-primary" />
            Nova conta a {isReceivable ? "receber" : "pagar"}
          </DialogTitle>
          <DialogDescription>
            Registre um documento único ou distribua o valor total em parcelas com vencimentos
            editáveis.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          id={`manual-${direction}-form`}
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          <section className="space-y-4 rounded-xl border p-4">
            <div>
              <h3 className="text-sm font-semibold">Identificação do documento</h3>
              <p className="text-xs text-muted-foreground">
                Informe a empresa, a parte relacionada e os dados do documento original.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {isReceivable ? (
                <div className="space-y-1.5">
                  <Label htmlFor="manual-entry-operator">Empresa operadora</Label>
                  <Controller
                    control={form.control}
                    name="operatingCompanyId"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          form.setValue("financialCategoryId", "");
                          form.setValue("costCenterId", "");
                        }}
                      >
                        <SelectTrigger
                          id="manual-entry-operator"
                          aria-invalid={Boolean(form.formState.errors.operatingCompanyId)}
                        >
                          <SelectValue placeholder="Selecione a empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          {(companies.data ?? []).map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError message={form.formState.errors.operatingCompanyId?.message} />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="manual-entry-counterparty">
                  {isReceivable ? "Cliente" : "Fornecedor"}
                </Label>
                <Controller
                  control={form.control}
                  name="counterpartyId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="manual-entry-counterparty"
                        aria-invalid={Boolean(form.formState.errors.counterpartyId)}
                      >
                        <SelectValue
                          placeholder={`Selecione ${isReceivable ? "o cliente" : "o fornecedor"}`}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(counterparties.data ?? []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError message={form.formState.errors.counterpartyId?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-entry-document-type">Tipo de documento</Label>
                <Controller
                  control={form.control}
                  name="documentTypeId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="manual-entry-document-type"
                        aria-invalid={Boolean(form.formState.errors.documentTypeId)}
                      >
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableDocumentTypes.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.code} - {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError message={form.formState.errors.documentTypeId?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-entry-document">Número do documento</Label>
                <Input
                  id="manual-entry-document"
                  maxLength={80}
                  placeholder="Ex.: 123456"
                  aria-invalid={Boolean(form.formState.errors.document)}
                  {...form.register("document")}
                />
                <FieldError message={form.formState.errors.document?.message} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="manual-entry-description">Descrição</Label>
                <Input
                  id="manual-entry-description"
                  maxLength={500}
                  aria-invalid={Boolean(form.formState.errors.description)}
                  {...form.register("description")}
                />
                <FieldError message={form.formState.errors.description?.message} />
              </div>
            </div>
            {loadError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Não foi possível carregar as opções do lançamento. Feche e tente novamente.
              </p>
            ) : null}
          </section>

          <section className="space-y-4 rounded-xl border p-4">
            <div>
              <h3 className="text-sm font-semibold">Classificação financeira</h3>
              <p className="text-xs text-muted-foreground">
                A categoria e o centro de custo serão replicados em todas as parcelas.
              </p>
            </div>
            <FinancialDimensionFields
              companyId={selectedCompanyId}
              direction={isReceivable ? "inflow" : "outflow"}
              categoryId={selectedCategoryId}
              costCenterId={selectedCostCenterId}
              onCategoryChange={(value) => form.setValue("financialCategoryId", value)}
              onCostCenterChange={(value) => form.setValue("costCenterId", value)}
            />
            <FieldError message={form.formState.errors.financialCategoryId?.message} />
          </section>

          <section className="space-y-4 rounded-xl border p-4">
            <div>
              <h3 className="text-sm font-semibold">Valor e forma de lançamento</h3>
              <p className="text-xs text-muted-foreground">
                No parcelamento, o sistema calcula os valores e permite ajustes antes de salvar.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="manual-entry-total">Valor total do documento</Label>
                <Controller
                  control={form.control}
                  name="totalAmount"
                  render={({ field }) => (
                    <FinancialCurrencyInput
                      id="manual-entry-total"
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-invalid={Boolean(form.formState.errors.totalAmount)}
                    />
                  )}
                />
                <FieldError message={form.formState.errors.totalAmount?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-entry-competence">Competência</Label>
                <Input
                  id="manual-entry-competence"
                  type="month"
                  aria-invalid={Boolean(form.formState.errors.competence)}
                  {...form.register("competence")}
                />
                <FieldError message={form.formState.errors.competence?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-entry-mode">Forma de lançamento</Label>
                <Controller
                  control={form.control}
                  name="entryMode"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="manual-entry-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="single">Lançamento único</SelectItem>
                        <SelectItem value="installments">Lançamento parcelado</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
            {entryMode === "single" ? (
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="manual-entry-due">Data de vencimento</Label>
                <Input
                  id="manual-entry-due"
                  type="date"
                  aria-invalid={Boolean(form.formState.errors.dueDate)}
                  {...form.register("dueDate")}
                />
                <FieldError message={form.formState.errors.dueDate?.message} />
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="manual-entry-count">Quantidade de parcelas</Label>
                    <Input
                      id="manual-entry-count"
                      type="number"
                      min={2}
                      max={120}
                      {...form.register("installmentCount", { valueAsNumber: true })}
                    />
                    <FieldError message={form.formState.errors.installmentCount?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="manual-entry-interval">Prazo entre parcelas</Label>
                    <div className="relative">
                      <Input
                        id="manual-entry-interval"
                        type="number"
                        min={1}
                        max={3650}
                        className="pr-12"
                        {...form.register("intervalDays", { valueAsNumber: true })}
                      />
                      <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-muted-foreground">
                        dias
                      </span>
                    </div>
                    <FieldError message={form.formState.errors.intervalDays?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="manual-entry-first-due">Primeiro vencimento</Label>
                    <Input
                      id="manual-entry-first-due"
                      type="date"
                      {...form.register("firstDueDate")}
                    />
                    <FieldError message={form.formState.errors.firstDueDate?.message} />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="gap-2"
                    onClick={generateInstallments}
                  >
                    <Calculator className="size-4" />
                    Calcular parcelas
                  </Button>
                </div>
                {fields.length ? (
                  <div className="space-y-3">
                    {!scheduleIsCurrent ? (
                      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                        Os parâmetros foram alterados. Recalcule as parcelas antes de salvar.
                      </p>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {fields.map((field, index) => (
                        <div
                          key={field.id}
                          className="grid grid-cols-[auto_1fr_1fr] items-end gap-2 rounded-lg border bg-background p-3"
                        >
                          <Badge variant="secondary" className="mb-2 tabular-nums">
                            {index + 1}/{fields.length}
                          </Badge>
                          <div className="space-y-1">
                            <Label className="text-[11px]" htmlFor={`installment-date-${index}`}>
                              Vencimento
                            </Label>
                            <Input
                              id={`installment-date-${index}`}
                              type="date"
                              {...form.register(`installments.${index}.dueDate`)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px]" htmlFor={`installment-amount-${index}`}>
                              Valor
                            </Label>
                            <Controller
                              control={form.control}
                              name={`installments.${index}.amount`}
                              render={({ field: amountField }) => (
                                <FinancialCurrencyInput
                                  id={`installment-amount-${index}`}
                                  value={amountField.value}
                                  onValueChange={amountField.onChange}
                                  onBlur={amountField.onBlur}
                                />
                              )}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <CalendarDays className="size-4 text-primary" />
                        {fields.length} parcelas preparadas
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
                        <span>
                          Distribuído: <strong>{money.format(distributedCents / 100)}</strong>
                        </span>
                        <Badge
                          variant={distributedCents === totalCents ? "secondary" : "destructive"}
                        >
                          {distributedCents === totalCents
                            ? "Total conferido"
                            : `Diferença: ${money.format((totalCents - distributedCents) / 100)}`}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Informe a quantidade, o intervalo e o primeiro vencimento para gerar a previsão.
                  </p>
                )}
                <FieldError message={form.formState.errors.root?.installments?.message} />
              </div>
            )}
          </section>
          <div className="space-y-1.5">
            <Label htmlFor="manual-entry-notes">Observações</Label>
            <Textarea
              id="manual-entry-notes"
              rows={3}
              maxLength={4000}
              {...form.register("notes")}
            />
            <FieldError message={form.formState.errors.notes?.message} />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form={`manual-${direction}-form`}
            disabled={create.isPending || loadPending || loadError}
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {entryMode === "installments" ? "Incluir parcelas" : "Incluir conta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ManualReceivableDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  return (
    <ManualEntryDialog direction="receivable" open={open} onClose={onClose} onCreated={onCreated} />
  );
}
export function ManualPayableDialog({
  open,
  operatingCompanyId,
  onClose,
  onCreated,
}: {
  open: boolean;
  operatingCompanyId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  return (
    <ManualEntryDialog
      direction="payable"
      open={open}
      operatingCompanyId={operatingCompanyId}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
