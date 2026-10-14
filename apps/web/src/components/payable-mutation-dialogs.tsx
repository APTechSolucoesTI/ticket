import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EditablePayable = {
  id: string;
  revision: number;
  origin_type: string;
  document_number: string;
  description: string;
  cycle_start: string;
  due_date: string;
  total_amount: number;
  installment_number: number | null;
  installment_count: number | null;
};
type Props = { payable: EditablePayable; onClose(): void; onSaved(): Promise<void> };
const db = supabase as unknown as SupabaseClient;

export function EditPayableDialog({ payable, onClose, onSaved }: Props) {
  const manual = payable.origin_type === "manual";
  const schema = z
    .object({
      document: z.string().trim().min(2, "Informe o documento.").max(80),
      description: z.string().trim().min(2, "Informe a descrição.").max(500),
      competence: z.string().regex(/^\d{4}-\d{2}$/, "Informe a competência."),
      dueDate: z.string().min(1, "Informe o vencimento."),
      amount: z
        .string()
        .refine(
          (value) =>
            Number.isFinite(Number(value)) &&
            Number(value) >= (manual ? 0.01 : 0) &&
            Number(value) <= 999999999999.99,
          "Informe um valor válido.",
        ),
      reason: z.string().trim().min(3, "Informe o motivo com pelo menos 3 caracteres.").max(1000),
    })
    .refine((value) => value.dueDate >= `${value.competence}-01`, {
      path: ["dueDate"],
      message: "O vencimento não pode anteceder a competência.",
    });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      document: payable.document_number,
      description: payable.description,
      competence: payable.cycle_start.slice(0, 7),
      dueDate: payable.due_date,
      amount: String(payable.total_amount),
      reason: "",
    },
  });
  const save = useMutation({
    mutationFn: async (values: Values) => {
      const { error } = await db.rpc("update_supplier_payable", {
        p_id: payable.id,
        p_expected_revision: payable.revision,
        p_document_number: values.document,
        p_description: values.description,
        p_competence: `${values.competence}-01`,
        p_due_date: values.dueDate,
        p_total_amount: Number(values.amount),
        p_reason: values.reason,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await onSaved();
      toast.success("Lançamento alterado. Aprovações anteriores foram encerradas.");
      onClose();
    },
    onError: (error) => {
      if (typeof error === "object" && error && "code" in error && error.code === "40001")
        void onSaved();
      toast.error(getUserFacingError(error, "Não foi possível alterar o lançamento."));
    },
  });
  const fieldError = (name: keyof Values) => form.formState.errors[name]?.message;
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Alterar lançamento</DialogTitle>
          <DialogDescription>
            Atualize esta conta a pagar. O lançamento voltará para revisão e exigirá nova aprovação
            quando a alçada estiver habilitada.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          {payable.installment_count && payable.installment_count > 1 ? (
            <p className="rounded-lg border bg-muted/30 p-3 text-sm">
              Parcela {payable.installment_number} de {payable.installment_count}. A alteração afeta
              apenas esta parcela.
            </p>
          ) : null}
          <fieldset disabled={save.isPending} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-payable-document">Documento *</Label>
              <Input
                id="edit-payable-document"
                autoFocus
                maxLength={80}
                aria-invalid={Boolean(fieldError("document"))}
                {...form.register("document")}
              />
              {fieldError("document") ? (
                <p className="text-xs text-destructive">{fieldError("document")}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-payable-competence">Competência *</Label>
              <Input
                id="edit-payable-competence"
                type="month"
                readOnly={!manual}
                {...form.register("competence")}
              />
              {fieldError("competence") ? (
                <p className="text-xs text-destructive">{fieldError("competence")}</p>
              ) : null}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-payable-description">Descrição *</Label>
              <Textarea
                id="edit-payable-description"
                maxLength={500}
                aria-invalid={Boolean(fieldError("description"))}
                {...form.register("description")}
              />
              {fieldError("description") ? (
                <p className="text-xs text-destructive">{fieldError("description")}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-payable-due-date">Vencimento *</Label>
              <Input
                id="edit-payable-due-date"
                type="date"
                aria-invalid={Boolean(fieldError("dueDate"))}
                {...form.register("dueDate")}
              />
              {fieldError("dueDate") ? (
                <p className="text-xs text-destructive">{fieldError("dueDate")}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-payable-amount">Valor (R$) *</Label>
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FinancialCurrencyInput
                    id="edit-payable-amount"
                    value={field.value}
                    onValueChange={field.onChange}
                    readOnly={!manual}
                    aria-invalid={Boolean(fieldError("amount"))}
                  />
                )}
              />
              {fieldError("amount") ? (
                <p className="text-xs text-destructive">{fieldError("amount")}</p>
              ) : null}
            </div>
            {!manual ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                O valor e a competência são definidos pelo contrato e seus rateios. Documento,
                descrição e vencimento podem ser alterados.
              </p>
            ) : null}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-payable-reason">Motivo da alteração *</Label>
              <Textarea
                id="edit-payable-reason"
                maxLength={1000}
                placeholder="Descreva a correção para manter o histórico."
                aria-invalid={Boolean(fieldError("reason"))}
                {...form.register("reason")}
              />
              {fieldError("reason") ? (
                <p className="text-xs text-destructive">{fieldError("reason")}</p>
              ) : null}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Salvar alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeletePayableDialog({ payable, onClose, onSaved }: Props) {
  const [reason, setReason] = useState("");
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("delete_supplier_payable", {
        p_id: payable.id,
        p_expected_revision: payable.revision,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await onSaved();
      toast.success("Lançamento excluído. O histórico foi preservado.");
      onClose();
    },
    onError: (error) => {
      if (typeof error === "object" && error && "code" in error && error.code === "40001")
        void onSaved();
      toast.error(getUserFacingError(error, "Não foi possível excluir o lançamento."));
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
          <AlertDialogDescription>
            O documento <strong>{payable.document_number}</strong> será removido das listas e dos
            relatórios financeiros. As aprovações serão encerradas e o histórico será preservado.
            {payable.installment_count && payable.installment_count > 1
              ? " Apenas esta parcela será excluída."
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="delete-payable-reason">Motivo da exclusão *</Label>
          <Textarea
            id="delete-payable-reason"
            autoFocus
            maxLength={1000}
            value={reason}
            disabled={remove.isPending}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Informe por que este lançamento deve ser excluído."
          />
          <p className="text-xs text-muted-foreground">Use pelo menos 3 caracteres.</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={remove.isPending || reason.trim().length < 3}
            onClick={(event) => {
              event.preventDefault();
              remove.mutate();
            }}
          >
            {remove.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 size-4" />
            )}
            Excluir lançamento
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
