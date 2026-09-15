import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Controller, useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
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

const db = supabase as unknown as SupabaseClient;
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);

const commonSchema = z
  .object({
    document: z.string().trim().min(2, "Informe o documento.").max(80),
    description: z.string().trim().min(2, "Informe a descrição.").max(500),
    competence: z.string().regex(/^\d{4}-\d{2}$/, "Informe a competência."),
    dueDate: z.string().min(1, "Informe o vencimento."),
    amount: z.coerce
      .number({ error: "Informe o valor." })
      .positive("O valor deve ser maior que zero.")
      .max(999_999_999.99, "O valor máximo é R$ 999.999.999,99."),
    notes: z.string().trim().max(4000, "Use no máximo 4.000 caracteres."),
  })
  .superRefine((value, context) => {
    if (value.dueDate < `${value.competence}-01`) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "O vencimento não pode anteceder a competência.",
      });
    }
  });

const receivableSchema = commonSchema.and(
  z.object({
    operatingCompanyId: z.string().uuid("Selecione a empresa operadora."),
    customerId: z.string().uuid("Selecione o cliente."),
  }),
);
const payableSchema = commonSchema.and(
  z.object({
    supplierId: z.string().uuid("Selecione o fornecedor."),
    document: z.string().trim().min(5, "Use ao menos 5 caracteres.").max(80),
  }),
);

type ReceivableForm = z.input<typeof receivableSchema>;
type PayableForm = z.input<typeof payableSchema>;
type Option = { id: string; label: string };

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

function CommonFields({
  form,
  documentMinLength = 2,
}: {
  form: ReturnType<typeof useForm<PayableForm>> | ReturnType<typeof useForm<ReceivableForm>>;
  documentMinLength?: number;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = form;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="manual-entry-document">Documento</Label>
          <Input
            id="manual-entry-document"
            autoFocus
            maxLength={80}
            aria-invalid={Boolean(errors.document)}
            {...register("document", {
              minLength: documentMinLength,
            })}
          />
          <FieldError message={errors.document?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-entry-amount">Valor</Label>
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <FinancialCurrencyInput
                id="manual-entry-amount"
                value={field.value as string | number}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={Boolean(errors.amount)}
              />
            )}
          />
          <FieldError message={errors.amount?.message} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="manual-entry-description">Descrição</Label>
        <Input
          id="manual-entry-description"
          maxLength={500}
          aria-invalid={Boolean(errors.description)}
          {...register("description")}
        />
        <FieldError message={errors.description?.message} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="manual-entry-competence">Competência</Label>
          <Input
            id="manual-entry-competence"
            type="month"
            aria-invalid={Boolean(errors.competence)}
            {...register("competence")}
          />
          <FieldError message={errors.competence?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-entry-due">Vencimento</Label>
          <Input
            id="manual-entry-due"
            type="date"
            aria-invalid={Boolean(errors.dueDate)}
            {...register("dueDate")}
          />
          <FieldError message={errors.dueDate?.message} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="manual-entry-notes">Observações</Label>
        <Textarea id="manual-entry-notes" rows={3} maxLength={4000} {...register("notes")} />
        <FieldError message={errors.notes?.message} />
      </div>
    </>
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
  const form = useForm<ReceivableForm>({
    resolver: zodResolver(receivableSchema),
    defaultValues: {
      operatingCompanyId: "",
      customerId: "",
      document: "",
      description: "",
      competence: currentMonth(),
      dueDate: today(),
      amount: "",
      notes: "",
    },
  });
  const companies = useQuery({
    queryKey: ["manual-receivable-operating-companies"],
    enabled: open,
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
  const customers = useQuery({
    queryKey: ["manual-receivable-customers"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await db.from("companies").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []).map((item) => ({ id: item.id, label: item.name })) as Option[];
    },
  });
  useEffect(() => {
    if (open && companies.data?.length === 1) {
      form.setValue("operatingCompanyId", companies.data[0].id, { shouldValidate: true });
    }
  }, [companies.data, form, open]);
  useEffect(() => {
    if (!open) form.reset();
  }, [form, open]);
  const create = useMutation({
    mutationFn: async (values: ReceivableForm) => {
      const parsed = receivableSchema.parse(values);
      const { data, error } = await db.rpc("create_manual_receivable", {
        p_operating_company_id: parsed.operatingCompanyId,
        p_company_id: parsed.customerId,
        p_document_reference: parsed.document,
        p_description: parsed.description,
        p_competence: `${parsed.competence}-01`,
        p_due_date: parsed.dueDate,
        p_amount: parsed.amount,
        p_notes: parsed.notes || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Conta a receber incluída com sucesso.");
      form.reset();
      onCreated();
      onClose();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível incluir a conta a receber.")),
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova conta a receber</DialogTitle>
          <DialogDescription>
            Inclua uma receita avulsa para a empresa operadora e o cliente selecionados.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          id="manual-receivable-form"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="manual-receivable-operator">Empresa operadora</Label>
              <Controller
                control={form.control}
                name="operatingCompanyId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="manual-receivable-operator"
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
            <div className="space-y-1.5">
              <Label htmlFor="manual-receivable-customer">Cliente</Label>
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="manual-receivable-customer"
                      aria-invalid={Boolean(form.formState.errors.customerId)}
                    >
                      <SelectValue placeholder="Selecione o cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {(customers.data ?? []).map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError message={form.formState.errors.customerId?.message} />
            </div>
          </div>
          {companies.isError || customers.isError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Não foi possível carregar empresas e clientes. Feche e tente novamente.
            </p>
          ) : null}
          <CommonFields form={form} />
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="manual-receivable-form"
            disabled={create.isPending || companies.isLoading || customers.isLoading}
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Incluir conta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const form = useForm<PayableForm>({
    resolver: zodResolver(payableSchema),
    defaultValues: {
      supplierId: "",
      document: "",
      description: "",
      competence: currentMonth(),
      dueDate: today(),
      amount: "",
      notes: "",
    },
  });
  const suppliers = useQuery({
    queryKey: ["manual-payable-suppliers"],
    enabled: open,
    queryFn: async () => {
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
  useEffect(() => {
    if (!open) form.reset();
  }, [form, open]);
  const create = useMutation({
    mutationFn: async (values: PayableForm) => {
      const parsed = payableSchema.parse(values);
      const { data, error } = await db.rpc("create_manual_supplier_payable", {
        p_operating_company_id: operatingCompanyId,
        p_supplier_id: parsed.supplierId,
        p_document_number: parsed.document,
        p_description: parsed.description,
        p_competence: `${parsed.competence}-01`,
        p_due_date: parsed.dueDate,
        p_amount: parsed.amount,
        p_notes: parsed.notes || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Conta a pagar incluída com sucesso.");
      form.reset();
      onCreated();
      onClose();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível incluir a conta a pagar.")),
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova conta a pagar</DialogTitle>
          <DialogDescription>
            O lançamento será associado à empresa operadora selecionada e poderá seguir para
            aprovação e pagamento.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          id="manual-payable-form"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          <div className="space-y-1.5">
            <Label htmlFor="manual-payable-supplier">Fornecedor</Label>
            <Controller
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="manual-payable-supplier"
                    aria-invalid={Boolean(form.formState.errors.supplierId)}
                  >
                    <SelectValue placeholder="Selecione o fornecedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {(suppliers.data ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError message={form.formState.errors.supplierId?.message} />
          </div>
          {suppliers.isError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Não foi possível carregar os fornecedores. Feche e tente novamente.
            </p>
          ) : null}
          <CommonFields form={form} documentMinLength={5} />
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="manual-payable-form"
            disabled={create.isPending || suppliers.isLoading || !operatingCompanyId}
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Incluir conta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
