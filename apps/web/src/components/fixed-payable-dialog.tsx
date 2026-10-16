import { useState } from "react";
import { PayableAttachmentEditor } from "@/components/payable-attachment-editor";
import {
  discardPayableUploads,
  uploadPayableAttachments,
  type PayableAttachmentDraft,
} from "@/lib/payable-attachments";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Loader2, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FinancialCurrencyInput } from "@/components/ui/decimal-input";
import { ContractAllocationEditor } from "@/components/contract-allocation-editor";
import {
  allocationError,
  allocationPayload,
  type ContractAllocation,
} from "@/lib/contract-allocations";
import { useFinancialDocumentTypes } from "@/hooks/use-financial-document-types";
import {
  fixedDb,
  fixedMonth,
  refreshFixedPayables,
  type FixedPayable,
  type FixedOccurrence,
} from "@/lib/fixed-payables";
import { getUserFacingError } from "@/lib/user-facing-error";
import { FinancialOperatingCompany } from "@/components/financial-operating-company";

const schema = z.object({
  supplier_id: z.string().uuid("Selecione o fornecedor."),
  document_type_id: z.string().uuid("Selecione o tipo de documento."),
  description: z.string().trim().min(2, "Informe a descrição.").max(500),
  total_amount: z
    .string()
    .refine(
      (v) => Number(v) > 0 && Number(v) <= 999999999.99,
      "Informe um valor entre R$ 0,01 e R$ 999.999.999,99.",
    ),
  document_number: z.string().trim().max(80),
  start_month: z.string(),
  end_month: z.string(),
  due_day: z.string(),
  due_date: z.string(),
  notes: z.string().trim().max(4000),
});
type Values = z.infer<typeof schema>;
export function FixedPayableDialog({
  companyId,
  companyName,
  template,
  occurrence,
  confirm = false,
  onClose,
}: {
  companyId: string;
  companyName: string;
  template?: FixedPayable;
  occurrence?: FixedOccurrence;
  confirm?: boolean;
  onClose(): void;
}) {
  const client = useQueryClient();
  const original = occurrence ?? template;
  const [attachments, setAttachments] = useState<PayableAttachmentDraft[]>([]);
  const [categories, setCategories] = useState<ContractAllocation[]>(
    original?.category_allocations ?? [],
  );
  const [centers, setCenters] = useState<ContractAllocation[]>(
    original?.cost_center_allocations ?? [],
  );
  const [categoriesValid, setCategoriesValid] = useState(false),
    [centersValid, setCentersValid] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false),
    [pendingValues, setPendingValues] = useState<Values>();
  const month = new Date().toISOString().slice(0, 7);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      supplier_id: original?.supplier_id ?? "",
      document_type_id: original?.document_type_id ?? "",
      description: original?.description ?? "",
      total_amount: original ? String(original.total_amount) : "",
      document_number: "",
      start_month: template?.start_month.slice(0, 7) ?? month,
      end_month: template?.end_month?.slice(0, 7) ?? "",
      due_day: String(template?.due_day ?? 10),
      due_date: occurrence?.due_date ?? "",
      notes: original?.notes ?? "",
    },
  });
  const types = useFinancialDocumentTypes();
  const suppliers = useQuery({
    queryKey: ["fixed-payable-suppliers"],
    queryFn: async () => {
      const { data, error } = await fixedDb
        .from("suppliers")
        .select("id,legal_name,trade_name")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; legal_name: string; trade_name: string | null }>;
    },
  });
  const availableTypes = (types.data ?? []).filter(
    (t) => t.is_active && t.availability !== "receivable",
  );
  const mutation = useMutation({
    mutationFn: async (values: Values) => {
      const issue =
        allocationError(categories, "categorias financeiras") ??
        allocationError(centers, "centros de custo");
      if (issue || !categoriesValid || !centersValid)
        throw new Error(issue ?? "Revise os rateios.");
      const payload = {
        ...values,
        operating_company_id: companyId,
        total_amount: Number(values.total_amount),
        due_day: Number(values.due_day),
        start_month: `${values.start_month}-01`,
        end_month: values.end_month ? `${values.end_month}-01` : null,
        category_allocations: allocationPayload(categories),
        cost_center_allocations: allocationPayload(centers),
      };
      const uploaded = confirm ? await uploadPayableAttachments(attachments, companyId) : [];
      try {
        const { error } = occurrence
          ? await fixedDb.rpc(
              confirm ? "confirmar_previsao_conta_fixa" : "save_fixed_payable_occurrence",
              {
                p_id: occurrence.id,
                p_expected_revision: occurrence.revision,
                p_payload: {
                  ...payload,
                  ...(confirm ? { attachments: uploaded } : {}),
                },
              },
            )
          : await fixedDb.rpc("save_fixed_payable", {
              p_id: template?.id ?? null,
              p_expected_revision: template?.revision ?? null,
              p_payload: payload,
              p_apply_future: true,
            });
        if (error) throw error;
      } catch (error) {
        await discardPayableUploads(uploaded);
        throw error;
      }
    },
    onSuccess: async () => {
      toast.success(
        confirm
          ? "Previsão confirmada. Título incluído no contas a pagar."
          : occurrence
            ? "Previsão atualizada."
            : "Conta fixa salva e previsões geradas.",
      );
      await refreshFixedPayables(client);
      onClose();
    },
    onError: (error) => {
      toast.error(getUserFacingError(error, "Não foi possível salvar a conta fixa."));
      void refreshFixedPayables(client);
    },
  });
  const submit = form.handleSubmit((values) => {
    if (mutation.isPending) return;
    if (confirm && values.document_number.length < 2) {
      form.setError("document_number", {
        message: "Informe o número do documento com pelo menos 2 caracteres.",
      });
      return;
    }
    if (
      !occurrence &&
      (!/^\d{4}-\d{2}$/.test(values.start_month) ||
        (values.end_month && values.end_month < values.start_month))
    ) {
      form.setError("end_month", {
        message: "Lançar até deve ser igual ou posterior ao mês inicial.",
      });
      return;
    }
    if (
      !occurrence &&
      (!Number.isInteger(Number(values.due_day)) ||
        Number(values.due_day) < 1 ||
        Number(values.due_day) > 31)
    ) {
      form.setError("due_day", { message: "Informe um dia entre 1 e 31." });
      return;
    }
    if (occurrence && (!values.due_date || values.due_date < occurrence.competence)) {
      form.setError("due_date", { message: "O vencimento não pode anteceder a competência." });
      return;
    }
    if (template) {
      setPendingValues(values);
      setScopeOpen(true);
    } else mutation.mutate(values);
  });
  const busy = mutation.isPending;
  const error = (name: keyof Values) =>
    form.formState.errors[name]?.message ? (
      <p className="text-xs text-destructive">{form.formState.errors[name]?.message}</p>
    ) : null;
  const title = confirm
    ? "Confirmar previsão"
    : occurrence
      ? "Editar previsão"
      : template
        ? "Editar conta fixa"
        : "Nova conta fixa";
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Repeat2 className="size-5" />
              {title}
            </DialogTitle>
            <DialogDescription>
              {occurrence
                ? `${fixedMonth(occurrence.competence)} · ${confirm ? "Informe o documento recebido e revise os valores deste mês." : "A alteração afeta somente esta competência."}`
                : "Despesa mensal recorrente. As previsões só entram nos valores reais a pagar após a confirmação."}
            </DialogDescription>
          </DialogHeader>
          <FinancialOperatingCompany name={companyName} />
          <form id="fixed-payable-form" className="space-y-5" onSubmit={submit}>
            <fieldset disabled={busy} className="space-y-5">
              <section className="space-y-4 rounded-xl border p-4">
                <h3 className="text-sm font-semibold">Identificação da despesa</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="fixed-supplier">Fornecedor *</Label>
                    <Select
                      value={form.watch("supplier_id")}
                      disabled={busy || suppliers.isPending}
                      onValueChange={(v) =>
                        form.setValue("supplier_id", v, { shouldValidate: true })
                      }
                    >
                      <SelectTrigger id="fixed-supplier">
                        <SelectValue placeholder="Selecione o fornecedor" />
                      </SelectTrigger>
                      <SelectContent>
                        {(suppliers.data ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.trade_name || s.legal_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {error("supplier_id")}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fixed-document-type">Tipo de documento *</Label>
                    <Select
                      value={form.watch("document_type_id")}
                      disabled={busy || types.isPending}
                      onValueChange={(v) =>
                        form.setValue("document_type_id", v, { shouldValidate: true })
                      }
                    >
                      <SelectTrigger id="fixed-document-type">
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTypes.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.code} - {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {error("document_type_id")}
                  </div>
                  {confirm ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="fixed-document">Número do documento *</Label>
                      <Input
                        id="fixed-document"
                        maxLength={80}
                        {...form.register("document_number")}
                      />
                      {error("document_number")}
                    </div>
                  ) : null}
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="fixed-description">Descrição *</Label>
                    <Input
                      id="fixed-description"
                      maxLength={500}
                      {...form.register("description")}
                    />
                    {error("description")}
                  </div>
                </div>
                {suppliers.isError || types.isError ? (
                  <p className="text-sm text-destructive">
                    Não foi possível carregar fornecedores ou tipos de documento.{" "}
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => {
                        void suppliers.refetch();
                        void types.refetch();
                      }}
                    >
                      Tentar novamente
                    </Button>
                  </p>
                ) : null}
              </section>
              <section className="space-y-4 rounded-xl border p-4">
                <h3 className="text-sm font-semibold">
                  {occurrence ? "Valor e vencimento do mês" : "Valor e recorrência mensal"}
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="fixed-amount">{occurrence ? "Valor" : "Valor base"} *</Label>
                    <FinancialCurrencyInput
                      id="fixed-amount"
                      value={form.watch("total_amount")}
                      onValueChange={(v) =>
                        form.setValue("total_amount", v, { shouldValidate: true })
                      }
                    />
                    {error("total_amount")}
                  </div>
                  {occurrence ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="fixed-due">Vencimento *</Label>
                      <Input id="fixed-due" type="date" {...form.register("due_date")} />
                      {error("due_date")}
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="fixed-start">Mês de início *</Label>
                        <Input id="fixed-start" type="month" {...form.register("start_month")} />
                        {error("start_month")}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="fixed-end">Lançar até</Label>
                        <Input id="fixed-end" type="month" {...form.register("end_month")} />
                        {error("end_month")}
                        <p className="text-xs text-muted-foreground">
                          Vazio: sem limite, com previsão dos próximos 12 meses.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="fixed-day">Dia de vencimento *</Label>
                        <Input
                          id="fixed-day"
                          type="number"
                          min={1}
                          max={31}
                          {...form.register("due_day")}
                        />
                        {error("due_day")}
                        <p className="text-xs text-muted-foreground">
                          Em meses menores, utiliza o último dia do mês.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="fixed-mode">Forma de lançamento</Label>
                        <Input id="fixed-mode" value="Lançamento único" readOnly />
                      </div>
                    </>
                  )}
                </div>
                {confirm ? (
                  <p className="text-xs text-muted-foreground">
                    A confirmação preserva o valor base do modelo e as demais previsões. O título
                    seguirá as regras normais de aprovação e pagamento.
                  </p>
                ) : null}
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Classificação financeira</h3>
                <p className="text-xs text-muted-foreground">
                  Cada grupo deve totalizar 100%, como nos contratos e lançamentos manuais.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <ContractAllocationEditor
                    companyId={companyId}
                    direction="outflow"
                    dimension="category"
                    value={categories}
                    onChange={setCategories}
                    onValidityChange={setCategoriesValid}
                    disabled={busy}
                  />
                  <ContractAllocationEditor
                    companyId={companyId}
                    direction="outflow"
                    dimension="cost_center"
                    value={centers}
                    onChange={setCenters}
                    onValidityChange={setCentersValid}
                    disabled={busy}
                  />
                </div>
              </section>
              {confirm ? (
                <PayableAttachmentEditor
                  value={attachments}
                  onChange={setAttachments}
                  disabled={busy}
                />
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="fixed-notes">Observações</Label>
                <Textarea id="fixed-notes" maxLength={4000} rows={3} {...form.register("notes")} />
                {error("notes")}
              </div>
            </fieldset>
          </form>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="fixed-payable-form"
              disabled={
                busy || !categoriesValid || !centersValid || suppliers.isError || types.isError
              }
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {confirm ? "Confirmar e criar título" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={scopeOpen} onOpenChange={(open) => !busy && setScopeOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar alteração às previsões futuras?</AlertDialogTitle>
            <AlertDialogDescription>
              As novas condições serão aplicadas apenas às competências do mês atual em diante ainda
              não confirmadas. Títulos confirmados serão preservados. Previsões fora do novo período
              serão excluídas; ampliar ou retirar o limite gera as novas competências.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setScopeOpen(false)}>
              Voltar
            </Button>
            <Button disabled={busy} onClick={() => pendingValues && mutation.mutate(pendingValues)}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Aplicar e salvar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
