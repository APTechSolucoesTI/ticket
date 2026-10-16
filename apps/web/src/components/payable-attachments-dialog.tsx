import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { PayableAttachments } from "@/components/payable-attachments";
import { PayableAttachmentEditor } from "@/components/payable-attachment-editor";
import { supabase } from "@/integrations/supabase/client";
import {
  discardPayableUploads,
  payableAttachmentCountLimit,
  uploadPayableAttachments,
  usePayableAttachments,
  type PayableAttachment,
  type PayableAttachmentDraft,
} from "@/lib/payable-attachments";
import { getUserFacingError } from "@/lib/user-facing-error";

const db = supabase as unknown as SupabaseClient;
type Payable = {
  id: string;
  document_number: string;
  operating_company_id: string;
  installment_number: number | null;
  installment_count: number | null;
};

export function PayableAttachmentsDialog({
  payable,
  canEdit,
  onClose,
}: {
  payable: Payable;
  canEdit: boolean;
  onClose(): void;
}) {
  const client = useQueryClient();
  const query = usePayableAttachments(payable.id);
  const [drafts, setDrafts] = useState<PayableAttachmentDraft[]>([]);
  const [removing, setRemoving] = useState<PayableAttachment>();
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["supplier-payable-attachments", payable.id] }),
      client.invalidateQueries({ queryKey: ["supplier-payables", payable.operating_company_id] }),
    ]);
  }
  const add = useMutation({
    mutationFn: async () => {
      if (!canEdit || !query.data)
        throw new Error("Aguarde a consulta dos anexos antes de incluir arquivos.");
      if (query.data.length + drafts.length > payableAttachmentCountLimit)
        throw new Error(
          "O lançamento pode ter no máximo 20 anexos. Exclua um arquivo antes de incluir outros.",
        );
      const uploaded = await uploadPayableAttachments(drafts, payable.operating_company_id);
      try {
        const { error } = await db.rpc("add_supplier_payable_attachments", {
          p_payable_id: payable.id,
          p_attachments: uploaded.map((item) => ({
            ...item,
            installment_number: payable.installment_number ?? 1,
          })),
        });
        if (error) throw error;
      } catch (error) {
        await discardPayableUploads(uploaded);
        throw error;
      }
    },
    onSuccess: async () => {
      setDrafts([]);
      await refresh();
      toast.success("Anexos incluídos no lançamento.");
    },
    onError: (error) => {
      toast.error(getUserFacingError(error, "Não foi possível incluir os anexos."));
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (item: PayableAttachment) => {
      if (!canEdit) throw new Error("Sem permissão para excluir anexos.");
      const { error } = await db.rpc("remove_supplier_payable_attachment", {
        p_payable_id: payable.id,
        p_attachment_id: item.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setRemoving(undefined);
      await refresh();
      toast.success("Anexo excluído do lançamento.");
    },
    onError: (error) => toast.error(getUserFacingError(error, "Não foi possível excluir o anexo.")),
  });
  const busy = add.isPending || remove.isPending;
  const count = query.data?.length ?? 0;
  const parcel =
    (payable.installment_count ?? 0) > 1
      ? `Parcela ${payable.installment_number}/${payable.installment_count}`
      : "Lançamento único";
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="size-5 text-primary" />
              Anexos do lançamento
            </DialogTitle>
            <DialogDescription>
              Consulte os arquivos e gerencie os documentos deste lançamento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-lg border bg-muted/25 p-3 text-sm">
            <p className="break-all font-medium">{payable.document_number}</p>
            <p className="text-xs text-muted-foreground">
              {parcel} · {query.isSuccess ? `${count} de 20 anexos` : "Consultando anexos…"}
            </p>
            {canEdit ? (
              <p className="text-xs text-muted-foreground">
                Os arquivos incluídos serão vinculados a{" "}
                {parcel === "Lançamento único" ? "este lançamento" : "esta parcela"}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Modo de leitura. Você pode consultar e baixar os arquivos.
              </p>
            )}
          </div>
          <PayableAttachments
            payableId={payable.id}
            onRemove={canEdit ? setRemoving : undefined}
            disabled={busy}
          />
          {canEdit ? (
            <>
              {count >= payableAttachmentCountLimit ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Limite de 20 anexos atingido. Exclua um arquivo para incluir outro.
                </p>
              ) : null}
              <PayableAttachmentEditor
                value={drafts}
                onChange={setDrafts}
                existingCount={count}
                disabled={busy || !query.isSuccess}
              />
            </>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Fechar
            </Button>
            {canEdit ? (
              <Button
                type="button"
                disabled={busy || !drafts.length || !query.isSuccess}
                onClick={() => {
                  if (!busy) add.mutate();
                }}
              >
                {add.isPending ? <Loader2 className="size-4 animate-spin" /> : null}Incluir anexos
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && !busy && setRemoving(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir anexo?</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              O arquivo {removing?.file_name} será retirado deste lançamento. A exclusão ficará
              registrada na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setRemoving(undefined)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => removing && !busy && remove.mutate(removing)}
            >
              {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : null}Excluir anexo
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
