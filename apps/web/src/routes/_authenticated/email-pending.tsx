import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { backendClient } from "@/lib/backend-client";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Link2, Mail, Trash2, Ban, RefreshCw, Paperclip, Eye, Download } from "lucide-react";
import { useModulePermissions } from "@/lib/permission-ui";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";

// Supabase/Postgrest/Storage errors are plain objects ({message, details,
// hint, code}), not real Error instances - `e instanceof Error` silently
// misses them and hides the actual reason. Check for `.message` instead.
function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string" && e.message) {
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return fallback;
}

export const Route = createFileRoute("/_authenticated/email-pending")({
  component: EmailPendingPage,
});

type Attachment = { path: string; name: string; size: number; type: string };
type PendingMessage = {
  id: string;
  message_id: string | null;
  subject: string | null;
  content: string;
  created_at: string;
  attachments: Attachment[];
};
type PendingRow = {
  contact_id: string;
  email: string;
  name: string;
  messages: PendingMessage[];
  last_at: string;
};

function EmailPendingPage() {
  const access = useModulePermissions("fila_email");
  const qc = useQueryClient();
  const [linking, setLinking] = useState<PendingRow | null>(null);
  const [viewing, setViewing] = useState<PendingRow | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    if (!access.create) return;
    setSyncing(true);
    try {
      const r = await backendClient.post<{
        processed: number;
        created: number;
        duplicates: number;
        skipped: number;
        errors: string[];
      }>("/channels/email/accounts/me/sync");
      const parts = [`${r.processed} mensagem(ns) verificada(s)`];
      if (r.created) parts.push(`${r.created} ticket(s) criado(s)`);
      if (r.duplicates) parts.push(`${r.duplicates} duplicada(s)`);
      if (r.skipped) parts.push(`${r.skipped} na fila`);
      if (r.errors.length) {
        toast.warning(`${parts.join(", ")} - ${r.errors.length} erro(s), veja o console.`);
        console.error("[email sync] errors", r.errors);
      } else {
        toast.success(parts.join(", ") || "Nenhuma mensagem nova.");
      }
      qc.invalidateQueries({ queryKey: ["email-pending"] });
    } catch (e) {
      console.error("[email sync]", e);
      toast.error(errorMessage(e, "Falha ao sincronizar"));
    } finally {
      setSyncing(false);
    }
  }

  const {
    data,
    isLoading,
    isError,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["email-pending"],
    queryFn: async (): Promise<PendingRow[]> => {
      const { data: msgs, error } = await supabase
        .from("email_pending_messages")
        .select(
          "id, contact_id, from_email, from_name, subject, content, message_id, attachments, created_at, contacts(name, company_id)",
        )
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const groups = new Map<string, PendingRow>();
      for (const m of msgs ?? []) {
        if (!m.contact_id) continue;
        const key = m.contact_id;
        const name =
          (m as { contacts?: { name?: string | null } | null }).contacts?.name ??
          m.from_name ??
          m.from_email;
        const g = groups.get(key) ?? {
          contact_id: m.contact_id,
          email: m.from_email,
          name,
          messages: [],
          last_at: m.created_at,
        };
        g.messages.push({
          id: m.id,
          message_id: m.message_id,
          subject: m.subject,
          content: m.content,
          created_at: m.created_at,
          attachments: Array.isArray(m.attachments)
            ? (m.attachments as unknown as Attachment[])
            : [],
        });
        if (m.created_at > g.last_at) g.last_at = m.created_at;
        groups.set(key, g);
      }
      return Array.from(groups.values()).sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
    },
  });

  const discard = useMutation({
    mutationFn: async (row: PendingRow) => {
      if (!access.edit) throw new Error("Sem permissão para editar a fila");
      const { error } = await supabase
        .from("email_pending_messages")
        .update({ resolved_at: new Date().toISOString() })
        .in(
          "id",
          row.messages.map((m) => m.id),
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mensagens descartadas");
      qc.invalidateQueries({ queryKey: ["email-pending"] });
    },
    onError: (e: Error) => toast.error(errorMessage(e, "Falha ao descartar mensagens")),
  });

  const block = useMutation({
    mutationFn: async (row: PendingRow) => {
      if (!access.edit) throw new Error("Sem permissão para editar a fila");
      const { error: upErr } = await supabase
        .from("contacts")
        .update({ is_active: false, can_open_tickets: false })
        .eq("id", row.contact_id);
      if (upErr) throw upErr;
      const { error: resolveError } = await supabase
        .from("email_pending_messages")
        .update({ resolved_at: new Date().toISOString() })
        .in(
          "id",
          row.messages.map((m) => m.id),
        );
      if (resolveError) throw resolveError;
    },
    onSuccess: () => {
      toast.success("E-mail bloqueado - novas mensagens desse remetente serão ignoradas.");
      qc.invalidateQueries({ queryKey: ["email-pending"] });
    },
    onError: (e: Error) => {
      console.error(e);
      toast.error(errorMessage(e, "Falha na operação"));
    },
  });

  const remove = useMutation({
    mutationFn: async (row: PendingRow) => {
      if (!access.delete) throw new Error("Sem permissão para excluir contatos da fila");
      const { error } = await supabase.from("contacts").delete().eq("id", row.contact_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contato excluído");
      qc.invalidateQueries({ queryKey: ["email-pending"] });
    },
    onError: (e: Error) => {
      console.error(e);
      toast.error(errorMessage(e, "Falha na operação"));
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Fila de E-mail</h1>
          <p className="text-sm text-muted-foreground">
            E-mails desconhecidos que enviaram mensagens. Vincule cada um a um cliente e contrato
            para liberar a abertura automática de tickets, ou bloqueie/exclua o remetente.
          </p>
        </div>
        {access.create && (
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Carregando fila de e-mail…" />
      ) : isError ? (
        <ErrorState
          title="Fila de e-mail indisponível"
          description={
            queryError instanceof Error
              ? queryError.message
              : "Não foi possível consultar mensagens pendentes."
          }
          action={{ label: "Tentar novamente", onClick: () => void refetch() }}
        />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Fila de e-mail livre"
          description="Nenhuma mensagem de remetente desconhecido aguarda tratamento."
        />
      ) : (
        <div className="space-y-3" aria-live="polite">
          {data!.map((row) => (
            <div
              key={row.contact_id}
              className="rounded-lg border border-border bg-card p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <Mail className="h-4 w-4 text-blue-500" />
                    {row.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.email} · {row.messages.length} mensagem(ns)
                  </div>
                </div>
                <div className="flex gap-2">
                  {access.edit && (
                    <Button size="sm" onClick={() => setLinking(row)}>
                      <Link2 className="h-4 w-4 mr-1" /> Vincular
                    </Button>
                  )}
                  {access.edit && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => block.mutate(row)}
                      disabled={block.isPending}
                      title="Bloquear remetente"
                    >
                      <Ban className="h-4 w-4" />
                    </Button>
                  )}
                  {access.delete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Excluir o contato "${row.name}" (${row.email})? Essa ação não pode ser desfeita.`,
                          )
                        ) {
                          remove.mutate(row);
                        }
                      }}
                      disabled={remove.isPending}
                      title="Excluir contato"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewing(row)}
                className="w-full rounded-md bg-muted/40 p-2 text-left text-xs hover:bg-muted/70 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">
                    {row.messages[0]?.subject ? (
                      <span className="font-medium">{row.messages[0].subject}</span>
                    ) : (
                      <span className="text-muted-foreground italic">(sem assunto)</span>
                    )}
                    {" - "}
                    <span className="text-muted-foreground">
                      {row.messages[0]?.content.slice(0, 80)}
                      {(row.messages[0]?.content.length ?? 0) > 80 ? "…" : ""}
                    </span>
                  </span>
                  <span className="ml-2 shrink-0 flex items-center gap-1 text-primary">
                    <Eye className="h-3.5 w-3.5" /> Ver
                  </span>
                </div>
                {row.messages.some((m) => m.attachments.length > 0) && (
                  <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                    <Paperclip className="h-3 w-3" />
                    {row.messages.reduce((sum, m) => sum + m.attachments.length, 0)} anexo(s)
                  </div>
                )}
              </button>
              {access.edit && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => discard.mutate(row)}
                    disabled={discard.isPending}
                  >
                    Descartar mensagens (manter contato)
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {viewing && <MessagesDialog row={viewing} onClose={() => setViewing(null)} />}

      {linking && access.edit && (
        <LinkDialog
          row={linking}
          onClose={() => setLinking(null)}
          onDone={() => {
            setLinking(null);
            qc.invalidateQueries({ queryKey: ["email-pending"] });
          }}
        />
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentLink({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reveal() {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("ticket-attachments")
        .createSignedUrl(attachment.path, 60 * 60);
      if (error || !data?.signedUrl) throw error ?? new Error("Falha ao gerar link");
      setUrl(data.signedUrl);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[attachment]", e);
      toast.error(errorMessage(e, "Falha ao abrir anexo"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={reveal}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-60"
    >
      <Download className="h-3 w-3" />
      <span className="truncate max-w-[180px]">{attachment.name}</span>
      <span className="text-muted-foreground">({formatBytes(attachment.size)})</span>
    </button>
  );
}

function MessagesDialog({ row, onClose }: { row: PendingRow; onClose: () => void }) {
  const [active, setActive] = useState(row.messages[0]?.id ?? "");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {row.name} <span className="text-muted-foreground font-normal">- {row.email}</span>
          </DialogTitle>
        </DialogHeader>
        <Tabs value={active} onValueChange={setActive} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
            {row.messages.map((m, i) => (
              <TabsTrigger
                key={m.id}
                value={m.id}
                className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                #{i + 1} · {new Date(m.created_at).toLocaleDateString("pt-BR")}{" "}
                {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </TabsTrigger>
            ))}
          </TabsList>
          {row.messages.map((m) => (
            <TabsContent
              key={m.id}
              value={m.id}
              className="flex-1 min-h-0 overflow-y-auto mt-3 space-y-3"
            >
              <div>
                <div className="text-xs text-muted-foreground">Assunto</div>
                <div className="text-sm font-semibold">{m.subject || "(sem assunto)"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Mensagem</div>
                <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap break-words">
                  {m.content || "(sem conteúdo)"}
                </div>
              </div>
              {m.attachments.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Paperclip className="h-3 w-3" /> Anexos ({m.attachments.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {m.attachments.map((a, i) => (
                      <AttachmentLink key={`${a.path}-${i}`} attachment={a} />
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EligibleContract = { id: string; name: string; sla_policy_id: string | null };

function LinkDialog({
  row,
  onClose,
  onDone,
}: {
  row: PendingRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const access = useModulePermissions("fila_email");
  const [companyId, setCompanyId] = useState<string>("");
  const [name, setName] = useState(row.name);
  const [email, setEmail] = useState(row.email);
  const [saving, setSaving] = useState(false);
  const [contracts, setContracts] = useState<EligibleContract[] | null>(null);
  const [loadingContracts, setLoadingContracts] = useState(false);

  const { data: companies } = useQuery({
    queryKey: ["companies-select"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!companyId) {
      setContracts(null);
      return;
    }
    let cancelled = false;
    setLoadingContracts(true);
    supabase
      .from("contracts")
      .select(
        "id, status, sla_policy_id, includes_remote, includes_lab, includes_onsite, contract_types(name)",
      )
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("starts_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setContracts([]);
        } else {
          const eligible = (data ?? [])
            .filter((c) => c.includes_remote || c.includes_lab || c.includes_onsite)
            .map((c) => ({
              id: c.id,
              name:
                (c as { contract_types?: { name?: string | null } | null }).contract_types?.name ??
                "Contrato",
              sla_policy_id: c.sla_policy_id,
            }));
          setContracts(eligible);
        }
        setLoadingContracts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const canSave = useMemo(() => !!companyId && !!name.trim(), [companyId, name]);

  // Safety valve for contacts that piled up a huge backlog (e.g. a mailbox
  // that's itself the target of automated reports) - cap how many messages
  // get merged into the auto-created ticket, and insert in batches so one
  // oversized request can't fail the whole "vincular" action.
  const MAX_MESSAGES_PER_TICKET = 200;
  const INSERT_BATCH_SIZE = 50;

  async function handleSave() {
    if (!access.edit) return;
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

      const contract = contracts && contracts.length > 0 ? contracts[0] : null;
      let ticketNumber: number | null = null;
      let truncated = false;

      if (contract) {
        const tenantId = await getMyTenantId();
        if (!tenantId) throw new Error("Tenant não encontrado");

        // Todas as mensagens pendentes desse contato viram UM ticket só,
        // em ordem cronológica - mesma conversa, não uma por e-mail.
        let ordered = [...row.messages].sort((a, b) =>
          a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
        );
        if (ordered.length > MAX_MESSAGES_PER_TICKET) {
          truncated = true;
          ordered = ordered.slice(-MAX_MESSAGES_PER_TICKET); // keep the most recent ones
        }
        const first = ordered[0];

        const { data: ticket, error: tErr } = await supabase
          .from("tickets")
          .insert({
            tenant_id: tenantId,
            subject: first.subject?.trim() || `E-mail de ${name.trim()}`,
            status: "new",
            priority: "medium",
            channel: "email",
            contact_id: row.contact_id,
            company_id: companyId,
            contract_id: contract.id,
            sla_policy_id: contract.sla_policy_id,
            pending_type: "awaiting_tech",
          })
          .select("id, number")
          .single();
        if (tErr) throw tErr;

        if (ticket) {
          ticketNumber = ticket.number;
          const rows = ordered.map((m) => ({
            tenant_id: tenantId,
            ticket_id: ticket.id,
            author_contact_id: row.contact_id,
            author_type: "contact" as const,
            channel: "email" as const,
            is_internal: false,
            content: m.content || "(sem conteúdo)",
            external_id: m.message_id,
            attachments: m.attachments,
          }));
          for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
            const { error: msgErr } = await supabase
              .from("messages")
              .insert(rows.slice(i, i + INSERT_BATCH_SIZE));
            if (msgErr) throw msgErr;
          }
        }
      }

      await supabase
        .from("email_pending_messages")
        .update({ resolved_at: new Date().toISOString() })
        .in(
          "id",
          row.messages.map((m) => m.id),
        );

      if (ticketNumber != null && truncated) {
        toast.success(
          `Contato vinculado. Ticket #${ticketNumber} criado com as últimas ${MAX_MESSAGES_PER_TICKET} mensagens (havia mais no acúmulo).`,
        );
      } else if (ticketNumber != null) {
        toast.success(`Contato vinculado. Ticket #${ticketNumber} criado.`);
      } else if (contracts && contracts.length === 0) {
        toast.warning(
          "Contato vinculado, mas a empresa não tem contrato ativo elegível - nenhum ticket foi criado.",
        );
      } else {
        toast.success("Contato vinculado.");
      }
      onDone();
    } catch (e) {
      console.error("[link contact]", e);
      toast.error(errorMessage(e, "Falha ao vincular"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular contato de e-mail</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>E-mail</Label>
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
          </div>
          {companyId && (
            <div className="rounded-md border p-2.5 text-xs">
              <div className="font-medium mb-1">Contrato ativo elegível</div>
              {loadingContracts ? (
                <span className="text-muted-foreground">Verificando…</span>
              ) : contracts && contracts.length > 0 ? (
                <>
                  <ul className="space-y-0.5">
                    {contracts.map((c) => (
                      <li key={c.id} className="text-green-600 dark:text-green-400">
                        ✓ {c.name}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-muted-foreground">
                    Ao vincular, um ticket será aberto automaticamente com{" "}
                    {row.messages.length === 1
                      ? "a mensagem já recebida"
                      : `as ${row.messages.length} mensagens já recebidas`}
                    .
                  </p>
                </>
              ) : (
                <span className="text-yellow-600 dark:text-yellow-400">
                  ⚠ Nenhum contrato ativo elegível (remoto/laboratório/presencial). Nenhum ticket
                  será aberto até a empresa ter um contrato ativo.
                </span>
              )}
            </div>
          )}
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
