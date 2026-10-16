import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Download, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { payableAttachmentBucket, payableAttachmentTypes } from "@/lib/payable-attachments";
import { getUserFacingError } from "@/lib/user-facing-error";

type Attachment = {
  id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  attachment_type: keyof typeof payableAttachmentTypes;
  type_description: string | null;
};
const db = supabase as unknown as SupabaseClient;
export function PayableAttachments({ payableId }: { payableId: string }) {
  const [downloading, setDownloading] = useState<string>();
  const query = useQuery({
    queryKey: ["supplier-payable-attachments", payableId],
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_payable_attachments")
        .select("id,storage_path,file_name,file_size,attachment_type,type_description")
        .eq("supplier_payable_id", payableId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Attachment[];
    },
  });
  async function download(item: Attachment) {
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
                <Badge variant="outline">
                  {payableAttachmentTypes[item.attachment_type]}
                  {item.type_description ? ` · ${item.type_description}` : ""}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {(item.file_size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={Boolean(downloading)}
              aria-label={`Baixar anexo ${item.file_name}`}
              onClick={() => void download(item)}
            >
              {downloading === item.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
            </Button>
          </div>
        ))
      )}
    </section>
  );
}
