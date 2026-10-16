import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Download, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  payableAttachmentBucket,
  payableAttachmentTypes,
  usePayableAttachments,
  type PayableAttachment,
} from "@/lib/payable-attachments";
import { getUserFacingError } from "@/lib/user-facing-error";

const db = supabase as unknown as SupabaseClient;
export function PayableAttachments({
  payableId,
  onRemove,
  disabled = false,
}: {
  payableId: string;
  onRemove?: (item: PayableAttachment) => void;
  disabled?: boolean;
}) {
  const [downloading, setDownloading] = useState<string>();
  const query = usePayableAttachments(payableId);
  async function download(item: PayableAttachment) {
    setDownloading(item.id);
    try {
      const { data, error } = await db.storage
        .from(payableAttachmentBucket)
        .download(item.storage_path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = item.file_name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(getUserFacingError(error, "Não foi possível baixar o anexo."));
    } finally {
      setDownloading(undefined);
    }
  }
  return (
    <section className="space-y-3 border-t pt-4" aria-label="Anexos do lançamento">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Paperclip className="size-4" />
        Anexos
      </h3>
      {query.isPending ? (
        <p className="text-xs text-muted-foreground">Carregando anexos…</p>
      ) : query.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive">
            Não foi possível consultar os anexos.
          </p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !query.data.length ? (
        <p className="text-xs text-muted-foreground">Este lançamento não possui anexos.</p>
      ) : (
        query.data.map((item) => (
          <div
            key={item.id}
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0 space-y-1">
              <p className="break-all text-sm font-medium">{item.file_name}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="max-w-full break-all">
                  {payableAttachmentTypes[item.attachment_type]}
                  {item.type_description ? ` · ${item.type_description}` : ""}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {(item.file_size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB
                </span>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled || Boolean(downloading)}
                aria-label={`Baixar anexo ${item.file_name}`}
                onClick={() => void download(item)}
              >
                {downloading === item.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
              </Button>
              {onRemove ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Excluir anexo ${item.file_name}`}
                  disabled={disabled || Boolean(downloading)}
                  onClick={() => onRemove(item)}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
