import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { decodeSessionUser, getToken } from "@/lib/session";

export const payableAttachmentTypes = {
  boleto: "Boleto",
  nota_fiscal: "Nota Fiscal",
  xml: "XML",
  outros: "Outros",
} as const;
export const payableAttachmentLimit = 10 * 1024 * 1024;
export const payableAttachmentCountLimit = 20;
export const payableAttachmentBucket = "supplier-payable-attachments";
export type PayableAttachmentDraft = {
  id: string;
  file: File;
  type: keyof typeof payableAttachmentTypes | "";
  description: string;
  installment: string;
};
export type UploadedPayableAttachment = {
  storage_path: string;
  file_name: string;
  file_size: number;
  content_type: string;
  attachment_type: string;
  type_description: string | null;
  installment_number: number;
};
export type PayableAttachment = {
  id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  attachment_type: keyof typeof payableAttachmentTypes;
  type_description: string | null;
};
const db = supabase as unknown as SupabaseClient;

export function usePayableAttachments(payableId: string) {
  return useQuery({
    queryKey: ["supplier-payable-attachments", payableId],
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_payable_attachments")
        .select("id,storage_path,file_name,file_size,attachment_type,type_description")
        .eq("supplier_payable_id", payableId)
        .is("deleted_at", null)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as PayableAttachment[];
    },
  });
}

export function payableAttachmentError(item: PayableAttachmentDraft, count?: number) {
  if (!item.type) return "Selecione o tipo do anexo.";
  if (item.type === "outros" && !item.description.trim()) return "Descreva o tipo do anexo.";
  if (item.description.trim().length > 200)
    return "Use no máximo 200 caracteres na descrição do tipo.";
  if (!item.file.size || item.file.size > payableAttachmentLimit)
    return "O arquivo deve ter entre 1 byte e 10 MB.";
  if (item.file.name.length > 255) return "O nome do arquivo deve ter no máximo 255 caracteres.";
  if (
    count !== undefined &&
    (!/^\d+$/.test(item.installment) ||
      Number(item.installment) < 1 ||
      Number(item.installment) > count)
  )
    return "Selecione uma parcela válida para este anexo.";
  return null;
}

// Files are staged first; the RPC links every file and creates the titles in one transaction.
// A failed upload never creates a payable. A failed RPC leaves drafts available to retry.
export async function uploadPayableAttachments(
  drafts: PayableAttachmentDraft[],
  companyId: string,
  installmentCount?: number,
) {
  if (drafts.length > payableAttachmentCountLimit)
    throw new Error("Inclua no máximo 20 anexos por lançamento.");
  for (const draft of drafts) {
    const issue = payableAttachmentError(draft, installmentCount);
    if (issue) throw new Error(`${draft.file.name}: ${issue}`);
  }
  if (!drafts.length) return [];
  const token = getToken();
  const user = token ? decodeSessionUser(token) : null;
  if (!user?.tenantId)
    throw new Error("Sessão indisponível. Entre novamente para enviar os anexos.");
  const uploaded: UploadedPayableAttachment[] = [];
  try {
    for (const draft of drafts) {
      const safeName = draft.file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.tenantId}/${companyId}/${user.id}/${crypto.randomUUID()}/${safeName}`;
      const { error } = await db.storage.from(payableAttachmentBucket).upload(path, draft.file, {
        contentType: draft.file.type || "application/octet-stream",
        upsert: false,
      });
      if (error) throw error;
      uploaded.push({
        storage_path: path,
        file_name: draft.file.name,
        file_size: draft.file.size,
        content_type: draft.file.type || "application/octet-stream",
        attachment_type: draft.type,
        type_description: draft.type === "outros" ? draft.description.trim() : null,
        installment_number: installmentCount === undefined ? 1 : Number(draft.installment),
      });
    }
    return uploaded;
  } catch (error) {
    await discardPayableUploads(uploaded);
    throw error;
  }
}

export async function discardPayableUploads(uploads: UploadedPayableAttachment[]) {
  if (!uploads.length) return;
  // Storage refuses deletion of linked objects, including after an ambiguous RPC response.
  await db.storage
    .from(payableAttachmentBucket)
    .remove(uploads.map((item) => item.storage_path))
    .catch(() => undefined);
}
