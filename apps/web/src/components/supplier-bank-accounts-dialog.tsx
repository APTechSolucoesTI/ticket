import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, Landmark, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { getUserFacingError } from "@/lib/user-facing-error";

export type SupplierBankAccount = {
  id: string;
  label: string;
  holder_name: string;
  holder_tax_id: string;
  bank_code: string | null;
  bank_name: string | null;
  branch: string | null;
  account_number: string | null;
  account_digit: string | null;
  account_type: "checking" | "savings" | "payment" | null;
  pix_key_type: "cpf" | "cnpj" | "email" | "phone" | "random" | null;
  pix_key: string | null;
  is_default: boolean;
};

const db = supabase as unknown as SupabaseClient;
type BankAccountForm = {
  label: string;
  holder_name: string;
  holder_tax_id: string;
  bank_code: string;
  bank_name: string;
  branch: string;
  account_number: string;
  account_digit: string;
  account_type: "checking" | "savings" | "payment";
  pix_key_type: string;
  pix_key: string;
  is_default: boolean;
};
const blank: BankAccountForm = {
  label: "Conta principal",
  holder_name: "",
  holder_tax_id: "",
  bank_code: "",
  bank_name: "",
  branch: "",
  account_number: "",
  account_digit: "",
  account_type: "checking" as const,
  pix_key_type: "none",
  pix_key: "",
  is_default: true,
};

export function SupplierBankAccountsDialog({
  supplierId,
  supplierName,
  canEdit,
  onClose,
}: {
  supplierId: string;
  supplierName: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SupplierBankAccount | null>();
  const [form, setForm] = useState(blank);
  const query = useQuery({
    queryKey: ["supplier-bank-accounts", supplierId],
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_bank_accounts")
        .select(
          "id,label,holder_name,holder_tax_id,bank_code,bank_name,branch,account_number,account_digit,account_type,pix_key_type,pix_key,is_default",
        )
        .eq("supplier_id", supplierId)
        .is("deleted_at", null)
        .order("is_default", { ascending: false })
        .order("label");
      if (error) throw error;
      return (data ?? []) as SupplierBankAccount[];
    },
  });
  const openForm = (account: SupplierBankAccount | null) => {
    setEditing(account);
    setForm(
      account
        ? {
            label: account.label,
            holder_name: account.holder_name,
            holder_tax_id: account.holder_tax_id,
            bank_code: account.bank_code ?? "",
            bank_name: account.bank_name ?? "",
            branch: account.branch ?? "",
            account_number: account.account_number ?? "",
            account_digit: account.account_digit ?? "",
            account_type: account.account_type ?? "checking",
            pix_key_type: account.pix_key_type ?? "none",
            pix_key: account.pix_key ?? "",
            is_default: account.is_default,
          }
        : { ...blank, is_default: !query.data?.length },
    );
  };
  const save = useMutation({
    mutationFn: async () => {
      if (form.label.trim().length < 2 || form.holder_name.trim().length < 2)
        throw new Error("Informe a identificação e o titular da conta.");
      const { error } = await db.rpc("save_supplier_bank_account", {
        p_bank_account_id: editing?.id ?? null,
        p_supplier_id: supplierId,
        p_label: form.label,
        p_holder_name: form.holder_name,
        p_holder_tax_id: form.holder_tax_id,
        p_bank_code: form.bank_code || null,
        p_bank_name: form.bank_name || null,
        p_branch: form.branch || null,
        p_account_number: form.account_number || null,
        p_account_digit: form.account_digit || null,
        p_account_type: form.bank_code ? form.account_type : null,
        p_pix_key_type: form.pix_key_type === "none" ? null : form.pix_key_type,
        p_pix_key: form.pix_key || null,
        p_is_default: form.is_default,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Dados bancários salvos.");
      setEditing(undefined);
      await queryClient.invalidateQueries({ queryKey: ["supplier-bank-accounts", supplierId] });
    },
    onError: (error) => toast.error(getUserFacingError(error, "salvar os dados bancários")),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("archive_supplier_bank_account", { p_bank_account_id: id });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Dado bancário arquivado.");
      await queryClient.invalidateQueries({ queryKey: ["supplier-bank-accounts", supplierId] });
    },
    onError: (error) => toast.error(getUserFacingError(error, "arquivar o dado bancário")),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="size-5" />
            Dados bancários
          </DialogTitle>
          <p className="text-sm text-muted-foreground">Fornecedor: {supplierName}</p>
        </DialogHeader>
        {editing !== undefined ? (
          <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="bank-label">Identificação</Label>
              <Input
                id="bank-label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bank-holder">Titular</Label>
              <Input
                id="bank-holder"
                value={form.holder_name}
                onChange={(e) => setForm({ ...form, holder_name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bank-tax">CPF ou CNPJ do titular</Label>
              <Input
                id="bank-tax"
                value={form.holder_tax_id}
                onChange={(e) => setForm({ ...form, holder_tax_id: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bank-code">Código do banco</Label>
              <Input
                id="bank-code"
                maxLength={3}
                placeholder="Ex.: 077"
                value={form.bank_code}
                onChange={(e) => setForm({ ...form, bank_code: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bank-name">Banco</Label>
              <Input
                id="bank-name"
                value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              />
            </div>
            <div>
              <Label>Tipo da conta</Label>
              <Select
                value={form.account_type}
                onValueChange={(value) =>
                  setForm({ ...form, account_type: value as typeof form.account_type })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Conta corrente</SelectItem>
                  <SelectItem value="savings">Poupança</SelectItem>
                  <SelectItem value="payment">Conta de pagamento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="bank-branch">Agência</Label>
              <Input
                id="bank-branch"
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <div>
                <Label htmlFor="bank-account">Conta</Label>
                <Input
                  id="bank-account"
                  value={form.account_number}
                  onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="bank-digit">Dígito</Label>
                <Input
                  id="bank-digit"
                  value={form.account_digit}
                  onChange={(e) => setForm({ ...form, account_digit: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Tipo da chave PIX</Label>
              <Select
                value={form.pix_key_type}
                onValueChange={(value) => setForm({ ...form, pix_key_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem PIX</SelectItem>
                  <SelectItem value="cpf">CPF</SelectItem>
                  <SelectItem value="cnpj">CNPJ</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="phone">Telefone</SelectItem>
                  <SelectItem value="random">Aleatória</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="bank-pix">Chave PIX</Label>
              <Input
                id="bank-pix"
                disabled={form.pix_key_type === "none"}
                value={form.pix_key}
                onChange={(e) => setForm({ ...form, pix_key: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.is_default}
                onCheckedChange={(value) => setForm({ ...form, is_default: value })}
              />
              Usar como conta principal
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setEditing(undefined)}>
                Cancelar
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Salvar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {query.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Carregando dados bancários...
              </p>
            ) : query.data?.length ? (
              query.data.map((account) => (
                <div
                  key={account.id}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{account.label}</p>
                      {account.is_default ? (
                        <Badge variant="secondary">
                          <CheckCircle2 className="mr-1 size-3" />
                          Principal
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {account.bank_code
                        ? `${account.bank_code} · ${account.bank_name} · Ag. ${account.branch} · Conta ${account.account_number}${account.account_digit ? `-${account.account_digit}` : ""}`
                        : "Pagamento via PIX"}
                    </p>
                    {account.pix_key ? (
                      <p className="text-xs text-muted-foreground">PIX: {account.pix_key}</p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Editar dado bancário"
                        onClick={() => openForm(account)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Arquivar dado bancário"
                        onClick={() => archive.mutate(account.id)}
                        disabled={archive.isPending}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhum dado bancário cadastrado.
              </p>
            )}
            {canEdit ? (
              <Button variant="outline" className="gap-2" onClick={() => openForm(null)}>
                <Plus className="size-4" />
                Adicionar dado bancário
              </Button>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
