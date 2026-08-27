import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { maskWhatsappPhone } from "@/lib/masks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Link2, MessageCircle, Trash2 } from "lucide-react";
import { useModulePermissions } from "@/lib/permission-ui";
import { AttachmentPreview, type Attachment } from "@/components/ticket/AttachmentPreview";

export const Route = createFileRoute("/_authenticated/whatsapp-pending")({
  component: WhatsAppPendingPage,
});

type PendingRow = {
  contact_id: string | null;
  phone: string;
  name: string;
  messages: Array<{
    id: string;
    content: string;
    created_at: string;
    attachments: Attachment[];
  }>;
  last_at: string;
};

function WhatsAppPendingPage() {
  const access = useModulePermissions("fila_whatsapp");
  const qc = useQueryClient();
  const [linking, setLinking] = useState<PendingRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["wa-pending"],
    queryFn: async (): Promise<PendingRow[]> => {
      const { data: msgs, error } = await supabase
        .from("whatsapp_pending_messages")
        .select(
          "id, contact_id, phone, content, attachments, created_at, contacts(name, company_id)",
        )
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const groups = new Map<string, PendingRow>();
      for (const m of msgs ?? []) {
        const key = m.contact_id ?? m.phone;
        const name =
          (m as { contacts?: { name?: string | null } | null }).contacts?.name ??
          `WhatsApp ${m.phone}`;
        const g = groups.get(key) ?? {
          contact_id: m.contact_id,
          phone: m.phone,
          name,
          messages: [],
          last_at: m.created_at,
        };
        g.messages.push({
          id: m.id,
          content: m.content,
          created_at: m.created_at,
          attachments: Array.isArray(m.attachments) ? (m.attachments as Attachment[]) : [],
        });
        if (m.created_at > g.last_at) g.last_at = m.created_at;
        groups.set(key, g);
      }
      return Array.from(groups.values()).sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
    },
  });

  const discard = useMutation({
    mutationFn: async (row: PendingRow) => {
      if (!access.delete) throw new Error("Sem permissão para descartar mensagens");
      await supabase
        .from("whatsapp_pending_messages")
        .update({ resolved_at: new Date().toISOString() })
        .in(
          "id",
          row.messages.map((m) => m.id),
        );
    },
    onSuccess: () => {
      toast.success("Mensagens descartadas");
      qc.invalidateQueries({ queryKey: ["wa-pending"] });
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Fila do WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Números desconhecidos que enviaram mensagens. Vincule cada um a um cliente e contrato para
          liberar a abertura automática de tickets.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma mensagem pendente.
        </div>
      ) : (
        <div className="space-y-3">
          {data!.map((row) => (
            <div
              key={row.contact_id ?? row.phone}
              className="rounded-lg border border-border bg-card p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <MessageCircle className="h-4 w-4 text-green-500" />
                    {row.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {maskWhatsappPhone(row.phone)} · {row.messages.length} mensagem(ns)
                  </div>
                </div>
                <div className="flex gap-2">
                  {access.edit && (
                    <Button size="sm" onClick={() => setLinking(row)}>
                      <Link2 className="h-4 w-4 mr-1" /> Vincular
                    </Button>
                  )}
                  {access.delete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => discard.mutate(row)}
                      disabled={discard.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-xs">
                {row.messages.slice(0, 10).map((m) => (
                  <div key={m.id} className="space-y-1.5 rounded-md bg-background/70 p-2">
                    <div>
                      <span className="text-muted-foreground">
                        {new Date(m.created_at).toLocaleString()} —{" "}
                      </span>
                      {m.content}
                    </div>
                    {m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {m.attachments.map((attachment, index) => (
                          <AttachmentPreview key={index} a={attachment} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {linking && access.edit && (
        <LinkDialog
          row={linking}
          onClose={() => setLinking(null)}
          onDone={() => {
            setLinking(null);
            qc.invalidateQueries({ queryKey: ["wa-pending"] });
          }}
        />
      )}
    </div>
  );
}

function LinkDialog({
  row,
  onClose,
  onDone,
}: {
  row: PendingRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const access = useModulePermissions("fila_whatsapp");
  const [companyId, setCompanyId] = useState<string>("");
  const [name, setName] = useState(row.name);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: companies } = useQuery({
    queryKey: ["companies-select"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const canSave = useMemo(() => !!companyId && !!name.trim(), [companyId, name]);

  async function handleSave() {
    if (!access.edit) return;
    if (!row.contact_id) return;
    setSaving(true);
    try {
      const { error: upErr } = await supabase
        .from("contacts")
        .update({
          company_id: companyId,
          name: name.trim(),
          email: email.trim() || null,
          can_open_tickets: true,
          is_active: true,
        })
        .eq("id", row.contact_id);
      if (upErr) throw upErr;

      await supabase
        .from("whatsapp_pending_messages")
        .update({ resolved_at: new Date().toISOString() })
        .in(
          "id",
          row.messages.map((m) => m.id),
        );

      toast.success("Contato vinculado. Novas mensagens abrirão tickets automaticamente.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao vincular");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular contato do WhatsApp</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Telefone</Label>
            <Input value={maskWhatsappPhone(row.phone)} disabled />
          </div>
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>E-mail (opcional)</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contato@empresa.com"
            />
          </div>
          <div>
            <Label>Cliente</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um cliente" />
              </SelectTrigger>
              <SelectContent>
                {(companies ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              O cliente precisa ter um contrato ativo com suporte para que novos tickets sejam
              abertos.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Salvando…" : "Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
