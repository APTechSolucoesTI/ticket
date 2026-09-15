import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Controller, useForm } from "react-hook-form";
import { FileCog, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import {
  useFinancialDocumentTypes,
  type FinancialDocumentType,
} from "@/hooks/use-financial-document-types";
import { getUserFacingError } from "@/lib/user-facing-error";

const db = supabase as unknown as SupabaseClient;

const availabilityLabels: Record<FinancialDocumentType["availability"], string> = {
  receivable: "Contas a receber",
  payable: "Contas a pagar",
  both: "Receber e pagar",
};

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Informe um código com ao menos 2 caracteres.")
    .max(20, "Use no máximo 20 caracteres.")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
      "Use letras, números, ponto, barra, hífen ou sublinhado.",
    ),
  name: z.string().trim().min(2, "Informe a descrição.").max(100, "Use no máximo 100 caracteres."),
  availability: z.enum(["receivable", "payable", "both"]),
  isActive: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

export function FinancialDocumentTypesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useFinancialDocumentTypes(open);
  const [editing, setEditing] = useState<FinancialDocumentType | null>(null);
  const [showForm, setShowForm] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "", name: "", availability: "both", isActive: true },
  });

  useEffect(() => {
    if (open) return;
    setEditing(null);
    setShowForm(false);
    form.reset();
  }, [form, open]);

  function startCreate() {
    setEditing(null);
    form.reset({ code: "", name: "", availability: "both", isActive: true });
    setShowForm(true);
  }

  function startEdit(item: FinancialDocumentType) {
    setEditing(item);
    form.reset({
      code: item.code,
      name: item.name,
      availability: item.availability,
      isActive: item.is_active,
    });
    setShowForm(true);
  }

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const parsed = schema.parse(values);
      const { data, error } = await db.rpc("save_financial_document_type", {
        p_id: editing?.id ?? null,
        p_code: parsed.code,
        p_name: parsed.name,
        p_availability: parsed.availability,
        p_is_active: parsed.isActive,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(editing ? "Tipo de documento atualizado." : "Tipo de documento criado.");
      setEditing(null);
      setShowForm(false);
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ["financial-document-types"] });
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível salvar o tipo de documento.")),
  });

  const toggle = useMutation({
    mutationFn: async (item: FinancialDocumentType) => {
      const { error } = await db.rpc("save_financial_document_type", {
        p_id: item.id,
        p_code: item.code,
        p_name: item.name,
        p_availability: item.availability,
        p_is_active: !item.is_active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Disponibilidade do tipo de documento atualizada.");
      void queryClient.invalidateQueries({ queryKey: ["financial-document-types"] });
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível atualizar o tipo de documento.")),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCog className="size-5 text-primary" /> Tipos de documento
          </DialogTitle>
          <DialogDescription>
            Defina quais documentos poderão ser usados em contas a receber, contas a pagar ou em
            ambos os lançamentos.
          </DialogDescription>
        </DialogHeader>

        {showForm ? (
          <form
            id="financial-document-type-form"
            className="space-y-4 rounded-xl border bg-muted/20 p-4"
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
          >
            <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="document-type-code">Código</Label>
                <Input
                  id="document-type-code"
                  autoFocus
                  maxLength={20}
                  placeholder="Ex.: NFE"
                  aria-invalid={Boolean(form.formState.errors.code)}
                  {...form.register("code")}
                />
                <FieldError message={form.formState.errors.code?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-type-name">Descrição</Label>
                <Input
                  id="document-type-name"
                  maxLength={100}
                  placeholder="Ex.: Nota Fiscal Eletrônica"
                  aria-invalid={Boolean(form.formState.errors.name)}
                  {...form.register("name")}
                />
                <FieldError message={form.formState.errors.name?.message} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="document-type-availability">Disponível em</Label>
                <Controller
                  control={form.control}
                  name="availability"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="document-type-availability">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="receivable">Contas a receber</SelectItem>
                        <SelectItem value="payable">Contas a pagar</SelectItem>
                        <SelectItem value="both">Contas a receber e a pagar</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="flex min-h-9 items-center gap-3 rounded-md border bg-background px-3">
                <Controller
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <Switch
                      id="document-type-active"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
                <Label htmlFor="document-type-active">Ativo</Label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setShowForm(false);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {editing ? "Salvar alterações" : "Criar tipo"}
              </Button>
            </div>
          </form>
        ) : (
          <Button className="w-full gap-2 sm:w-fit" onClick={startCreate}>
            <Plus className="size-4" /> Novo tipo de documento
          </Button>
        )}

        <div className="space-y-2">
          {query.isLoading ? (
            <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Carregando tipos de documento...
            </div>
          ) : query.isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Não foi possível carregar os tipos de documento.
            </div>
          ) : query.data?.length ? (
            query.data.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{item.code}</span>
                    <Badge variant="outline">{availabilityLabels[item.availability]}</Badge>
                    <Badge variant={item.is_active ? "secondary" : "outline"}>
                      {item.is_active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{item.name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                    <Switch
                      aria-label={`${item.is_active ? "Desativar" : "Ativar"} ${item.code}`}
                      checked={item.is_active}
                      disabled={toggle.isPending}
                      onCheckedChange={() => toggle.mutate(item)}
                    />
                    <span className="text-xs text-muted-foreground">Disponível</span>
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Editar ${item.code}`}
                    onClick={() => startEdit(item)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhum tipo de documento cadastrado.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
