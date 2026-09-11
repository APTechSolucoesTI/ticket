import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarClock, ExternalLink, Loader2, Paperclip, ReceiptText, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { SupplierBankAccount } from "@/components/supplier-bank-accounts-dialog";

type Payment = {
  id: string;
  status: "scheduled" | "paid" | "cancelled";
  payment_method: "pix" | "bank_transfer" | "boleto" | "other";
  scheduled_date: string;
  scheduled_amount: number;
  scheduled_by_name: string;
  scheduled_at: string;
  bank_snapshot: SupplierBankAccount;
  paid_at: string | null;
  paid_amount: number | null;
  reconciliation_status: "pending" | "matched" | "difference";
  difference_amount: number | null;
  transaction_reference: string | null;
  receipt_path: string | null;
  receipt_file_name: string | null;
  settled_by_name: string | null;
  cancellation_reason: string | null;
};

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const methods = { pix: "PIX", bank_transfer: "Transferência", boleto: "Boleto", other: "Outro" };
const accepted = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export function SupplierPaymentSection({
  payable,
  canEdit,
  onChanged,
}: {
  payable: {
    id: string;
    tenant_id: string;
    operating_company_id: string;
    supplier_id: string;
    status: string;
    due_date: string;
    total_amount: number;
  };
  canEdit: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(payable.due_date);
  const [bankId, setBankId] = useState("");
  const [method, setMethod] = useState<keyof typeof methods>("pix");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [showSettlement, setShowSettlement] = useState(false);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16));
  const [paidAmount, setPaidAmount] = useState(String(payable.total_amount));
  const [reference, setReference] = useState("");
  const [settlementNotes, setSettlementNotes] = useState("");
  const [receipt, setReceipt] = useState<File>();
  const [cancelReason, setCancelReason] = useState("");
  const accounts = useQuery({
    queryKey: ["supplier-bank-accounts", payable.supplier_id],
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_bank_accounts")
        .select(
          "id,label,holder_name,holder_tax_id,bank_code,bank_name,branch,account_number,account_digit,account_type,pix_key_type,pix_key,is_default",
        )
        .eq("supplier_id", payable.supplier_id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupplierBankAccount[];
    },
  });
  const payments = useQuery({
    queryKey: ["supplier-payments", payable.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_payments")
        .select(
          "id,status,payment_method,scheduled_date,scheduled_amount,scheduled_by_name,scheduled_at,bank_snapshot,paid_at,paid_amount,reconciliation_status,difference_amount,transaction_reference,receipt_path,receipt_file_name,settled_by_name,cancellation_reason",
        )
        .eq("supplier_payable_id", payable.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Payment[];
    },
  });
  const current = payments.data?.find((item) => item.status !== "cancelled");
  useEffect(() => {
    if (bankId || !accounts.data?.length) return;
    const preferred = accounts.data.find((item) => item.is_default) ?? accounts.data[0];
    setBankId(preferred.id);
  }, [accounts.data, bankId]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["supplier-payments", payable.id] }),
      queryClient.invalidateQueries({ queryKey: ["supplier-payables"] }),
    ]);
    onChanged();
  };
  const schedule = useMutation({
    mutationFn: async () => {
      if (!bankId) throw new Error("Cadastre e selecione os dados bancários do fornecedor.");
      const { error } = await db.rpc("schedule_supplier_payment", {
        p_supplier_payable_id: payable.id,
        p_bank_account_id: bankId,
        p_scheduled_date: scheduledDate,
        p_payment_method: method,
        p_notes: scheduleNotes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Pagamento programado.");
      setShowSchedule(false);
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "programar o pagamento")),
  });
  const settle = useMutation({
    mutationFn: async () => {
      if (!current || !receipt) throw new Error("Selecione o comprovante do pagamento.");
      if (!accepted.includes(receipt.type) || receipt.size > 10 * 1024 * 1024)
        throw new Error("Use PDF, PNG, JPG ou WEBP com até 10 MB.");
      const extension =
        receipt.name
          .split(".")
          .pop()
          ?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
      const path = `${payable.tenant_id}/${payable.operating_company_id}/${current.id}/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage
        .from("supplier-payment-receipts")
        .upload(path, receipt, { contentType: receipt.type, upsert: false });
      if (upload.error) throw upload.error;
      const result = await db.rpc("settle_supplier_payment", {
        p_payment_id: current.id,
        p_paid_at: new Date(paidAt).toISOString(),
        p_paid_amount: Number(paidAmount.replace(",", ".")),
        p_transaction_reference: reference,
        p_receipt_path: path,
        p_receipt_file_name: receipt.name,
        p_receipt_mime_type: receipt.type,
        p_receipt_size: receipt.size,
        p_notes: settlementNotes.trim() || null,
      });
      if (result.error) {
        await supabase.storage.from("supplier-payment-receipts").remove([path]);
        throw result.error;
      }
    },
    onSuccess: async () => {
      toast.success("Pagamento baixado e conciliado.");
      setShowSettlement(false);
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "baixar o pagamento")),
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (!current || cancelReason.trim().length < 3)
        throw new Error("Informe o motivo do cancelamento.");
      const { error } = await db.rpc("cancel_supplier_payment", {
        p_payment_id: current.id,
        p_reason: cancelReason,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Programação cancelada.");
      setCancelReason("");
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "cancelar a programação")),
  });
  const openReceipt = async () => {
    if (!current?.receipt_path) return;
    const { data, error } = await supabase.storage
      .from("supplier-payment-receipts")
      .createSignedUrl(current.receipt_path, 60);
    if (error) toast.error(getUserFacingError(error, "abrir o comprovante"));
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="supplier-payment-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="supplier-payment-title" className="font-medium">
            Pagamento
          </h3>
          <p className="text-xs text-muted-foreground">
            Programação, comprovante e conciliação da baixa.
          </p>
        </div>
        {current ? (
          <Badge variant={current.status === "paid" ? "secondary" : "outline"}>
            {current.status === "paid" ? "Pago" : "Programado"}
          </Badge>
        ) : null}
      </div>
      {payments.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando pagamento...</p>
      ) : current ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Data programada</p>
              <p className="font-medium">
                {new Date(`${current.scheduled_date}T00:00:00`).toLocaleDateString("pt-BR")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Forma</p>
              <p className="font-medium">{methods[current.payment_method]}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Valor programado</p>
              <p className="font-semibold">{money.format(current.scheduled_amount)}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Destino: {current.bank_snapshot.label} · {current.bank_snapshot.bank_name || "PIX"}
            {current.bank_snapshot.pix_key ? ` · ${current.bank_snapshot.pix_key}` : ""}
          </p>
          {current.status === "paid" ? (
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    Baixado em {new Date(current.paid_at!).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {money.format(current.paid_amount!)} · Ref. {current.transaction_reference}
                  </p>
                </div>
                <Badge
                  variant={
                    current.reconciliation_status === "matched" ? "secondary" : "destructive"
                  }
                >
                  {current.reconciliation_status === "matched"
                    ? "Valor conciliado"
                    : `Diferença ${money.format(current.difference_amount!)}`}
                </Badge>
              </div>
              <Button
                className="mt-3 gap-2"
                size="sm"
                variant="outline"
                onClick={() => void openReceipt()}
              >
                <ExternalLink className="size-4" />
                Abrir comprovante
              </Button>
            </div>
          ) : canEdit ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button className="gap-2" onClick={() => setShowSettlement((value) => !value)}>
                  <ReceiptText className="size-4" />
                  Registrar pagamento
                </Button>
              </div>
              {showSettlement ? (
                <div className="grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="paid-at">Data e hora</Label>
                    <Input
                      id="paid-at"
                      type="datetime-local"
                      value={paidAt}
                      onChange={(e) => setPaidAt(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="paid-amount">Valor pago</Label>
                    <Input
                      id="paid-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="paid-reference">Referência da transação</Label>
                    <Input
                      id="paid-reference"
                      maxLength={150}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="paid-receipt">Comprovante</Label>
                    <label
                      htmlFor="paid-receipt"
                      className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed p-3 text-sm hover:bg-muted/50"
                    >
                      <Paperclip className="size-4" />
                      {receipt?.name || "Selecionar PDF ou imagem"}
                    </label>
                    <Input
                      id="paid-receipt"
                      className="sr-only"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp"
                      onChange={(e) => setReceipt(e.target.files?.[0])}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="settlement-notes">Observações</Label>
                    <Textarea
                      id="settlement-notes"
                      maxLength={1000}
                      value={settlementNotes}
                      onChange={(e) => setSettlementNotes(e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2 flex justify-end">
                    <Button
                      onClick={() => settle.mutate()}
                      disabled={settle.isPending || !receipt || reference.trim().length < 2}
                    >
                      {settle.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                      Confirmar baixa
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  placeholder="Motivo para cancelar a programação"
                  maxLength={1000}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending || cancelReason.trim().length < 3}
                >
                  <X className="mr-2 size-4" />
                  Cancelar programação
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : payable.status === "approved" && canEdit ? (
        showSchedule ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Dados bancários</Label>
              <Select value={bankId} onValueChange={setBankId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.data?.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.label}
                      {account.is_default ? " · Principal" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!accounts.data?.length ? (
                <p className="mt-1 text-xs text-destructive">
                  Cadastre os dados bancários na linha do fornecedor.
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="schedule-date">Data programada</Label>
              <Input
                id="schedule-date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as keyof typeof methods)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="bank_transfer">Transferência</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="schedule-notes">Observações</Label>
              <Textarea
                id="schedule-notes"
                maxLength={1000}
                value={scheduleNotes}
                onChange={(e) => setScheduleNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setShowSchedule(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => schedule.mutate()}
                disabled={schedule.isPending || !bankId || !scheduledDate}
              >
                {schedule.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Programar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="gap-2" onClick={() => setShowSchedule(true)}>
            <CalendarClock className="size-4" />
            Programar pagamento
          </Button>
        )
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          O pagamento será liberado depois da aprovação integral do lançamento.
        </p>
      )}
      {payments.data?.some((item) => item.status === "cancelled") ? (
        <p className="text-xs text-muted-foreground">
          Há {payments.data.filter((item) => item.status === "cancelled").length} programação
          cancelada preservada no histórico.
        </p>
      ) : null}
    </section>
  );
}
