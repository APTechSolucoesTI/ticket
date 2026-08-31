import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TicketBadge, type TicketStatus } from "@/components/ticket/TicketBadge";
import { PriorityBadge } from "@/components/ticket/PriorityBadge";
import { PendingBadge, type PendingType } from "@/components/ticket/PendingBadge";
import { toast } from "sonner";
import {
  LogOut,
  Plus,
  RefreshCw,
  Inbox,
  Clock,
  CheckCircle2,
  AlertTriangle,
  CircleDollarSign,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import {
  getPortalToken,
  portalFetch,
  requestPortalOtp,
  setPortalToken,
  verifyPortalOtp,
} from "@/lib/portal-client";

export const Route = createFileRoute("/portal")({
  head: () => ({
    meta: [
      { title: "Portal do Cliente - APTicket" },
      { name: "description", content: "Acompanhe seus chamados e abra novas solicitações." },
    ],
  }),
  component: PortalPage,
});

type ContractOption = {
  id: string;
  name: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  equipment_ids: string[];
};
type SessionData = {
  contact: {
    id: string;
    name: string;
    email: string;
    company_name: string | null;
    can_open_tickets: boolean;
  };
  has_active_contract: boolean;
  contracts: ContractOption[];
  tickets: Array<{
    id: string;
    number: number;
    subject: string;
    status: TicketStatus;
    priority: "low" | "medium" | "high" | "urgent";
    created_at: string;
    pending_type?: PendingType;
  }>;
  equipments: Array<{ id: string; name: string; contact_id: string | null }>;
};

type LoginStep = "email" | "otp";

function PortalPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<LoginStep>("email");
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);

  const loadSession = async (): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await portalFetch("/api/public/portal/session", { method: "POST" });
      if (res.status === 401) {
        setPortalToken(null);
        setSession(null);
        return false;
      }
      const data = await res.json();
      if (!data.found) {
        toast.error(
          "Seu e-mail foi verificado, mas nenhum cadastro de cliente foi encontrado para ele.",
        );
        setPortalToken(null);
        return false;
      }
      setSession(data);
      return true;
    } catch {
      toast.error("Falha ao conectar ao portal.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Silently restore an existing (non-expired) session on load.
  useEffect(() => {
    (async () => {
      if (getPortalToken()) await loadSession();
      setRestoring(false);
    })();
  }, []);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await requestPortalOtp(email.trim());
      setStep("otp");
      toast.success("Se o e-mail estiver cadastrado, um código foi enviado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o código.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true);
    try {
      const result = await verifyPortalOtp(email.trim(), code);
      if (!result.ok) {
        toast.error("Código inválido ou expirado.");
        return;
      }
      const ok = await loadSession();
      if (ok) setStep("email"); // reset for a future logout
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setPortalToken(null);
    setSession(null);
    setEmail("");
    setCode("");
    setStep("email");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrandLogo className="size-8 drop-shadow-sm" />
            <h1 className="text-base font-semibold">Portal do Cliente</h1>
          </div>
          {session && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">{session.contact.email}</span>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="h-3.5 w-3.5 mr-1" /> Sair
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {restoring ? (
          <div className="text-center text-sm text-muted-foreground py-10">Carregando…</div>
        ) : !session ? (
          <Card className="max-w-md mx-auto p-6">
            {step === "email" ? (
              <>
                <h2 className="text-lg font-semibold">Acessar portal</h2>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  Informe seu e-mail cadastrado. Enviaremos um código de verificação.
                </p>
                <form onSubmit={handleRequestCode} className="space-y-3">
                  <div>
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="voce@empresa.com"
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Enviando..." : "Enviar código"}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Digite o código</h2>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  Enviamos um código de 6 dígitos para <strong>{email}</strong>. Ele expira em 10
                  minutos.
                </p>
                <form onSubmit={handleVerifyCode} className="space-y-3">
                  <div>
                    <Label htmlFor="code">Código</Label>
                    <Input
                      id="code"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      className="text-center text-lg tracking-[0.5em]"
                    />
                  </div>
                  <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
                    {loading ? "Verificando..." : "Entrar"}
                  </Button>
                  <div className="flex justify-between text-xs">
                    <button
                      type="button"
                      className="text-muted-foreground underline"
                      onClick={() => {
                        setStep("email");
                        setCode("");
                      }}
                    >
                      Trocar e-mail
                    </button>
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => {
                        requestPortalOtp(email.trim())
                          .then(() => toast.success("Código reenviado."))
                          .catch((error: unknown) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Não foi possível reenviar o código.",
                            ),
                          );
                      }}
                    >
                      Reenviar código
                    </button>
                  </div>
                </form>
              </>
            )}
          </Card>
        ) : (
          <PortalDashboard session={session} reload={loadSession} />
        )}
      </main>
    </div>
  );
}

type Attachment = { name: string; size: number; type: string; url: string | null };
type EquipmentInfo = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  asset_tag: string | null;
};
type TicketDetail = {
  ticket: {
    id: string;
    number: number;
    subject: string;
    status: TicketStatus;
    priority: "low" | "medium" | "high" | "urgent";
    channel: string;
    created_at: string;
    updated_at: string;
  };
  equipments: EquipmentInfo[];
  messages: Array<{
    id: string;
    content: string;
    author_type: "agent" | "contact" | "system";
    author_name: string;
    created_at: string;
    attachments?: Attachment[];
  }>;
};

function PortalDashboard({ session, reload }: { session: SessionData; reload: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [submitting, setSubmitting] = useState(false);
  const [equipmentIds, setEquipmentIds] = useState<string[]>([]);
  const [contractId, setContractId] = useState<string>("");
  const [avulsoConfirmed, setAvulsoConfirmed] = useState(false);
  const [contractPicker, setContractPicker] = useState<{ open: boolean; selected: string }>({
    open: false,
    selected: "",
  });
  const [eqPicker, setEqPicker] = useState<{
    open: boolean;
    items: { id: string; name: string }[];
    selected: string[];
  }>({ open: false, items: [], selected: [] });
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [replying, setReplying] = useState(false);
  const toggleEquipment = (id: string) =>
    setEquipmentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedContract = session.contracts.find((c) => c.id === contractId) ?? null;
  const availableEquipments = session.equipments;
  const coveredEquipmentIds = new Set(
    session.contracts.flatMap((contract) => contract.equipment_ids),
  );
  const isAvulso =
    !session.has_active_contract || equipmentIds.some((id) => !coveredEquipmentIds.has(id));

  useEffect(() => setAvulsoConfirmed(false), [equipmentIds, contractId]);

  const startTicketFlow = (cid: string) => {
    setContractId(cid);
    setEquipmentIds([]);
    setAvulsoConfirmed(false);
    setShowForm(true);
    // Sugestão de equipamentos: interseção entre equipamentos do contrato e do contato
    const contract = session.contracts.find((c) => c.id === cid);
    const allowed = contract?.equipment_ids ?? [];
    const pool =
      allowed.length > 0
        ? session.equipments.filter((e) => allowed.includes(e.id))
        : session.equipments;
    const suggested = pool.filter((e) => e.contact_id === session.contact.id);
    if (suggested.length === 1) {
      const only = suggested[0];
      if (
        window.confirm(
          `Equipamento vinculado ao seu usuário e ao contrato:\n\n• ${only.name}\n\nDeseja associar ao chamado?`,
        )
      ) {
        setEquipmentIds([only.id]);
      }
    } else if (suggested.length > 1) {
      setEqPicker({
        open: true,
        items: suggested.map((e) => ({ id: e.id, name: e.name })),
        selected: suggested.map((e) => e.id),
      });
    }
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    setReplying(true);
    try {
      const fd = new FormData();
      fd.append("ticket_id", selected.ticket.id);
      fd.append("content", reply);
      replyFiles.forEach((f) => fd.append("files", f));
      const res = await portalFetch("/api/public/portal/ticket-reply", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data?.error === "file_too_large" ? "Arquivo acima de 10MB." : "Falha ao enviar mensagem.",
        );
        return;
      }
      setReply("");
      setReplyFiles([]);
      await openTicket(selected.ticket.id);
      toast.success("Mensagem enviada.");
    } finally {
      setReplying(false);
    }
  };

  const canOpen = session.contact.can_open_tickets;

  const openTicket = async (ticketId: string) => {
    setLoadingDetail(ticketId);
    try {
      const res = await portalFetch("/api/public/portal/ticket-detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticketId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Não foi possível abrir o chamado.");
        return;
      }
      setSelected(data);
    } catch {
      toast.error("Falha ao carregar chamado.");
    } finally {
      setLoadingDetail(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAvulso && !avulsoConfirmed) {
      toast.error("Confirme que está ciente da cobrança avulsa");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("subject", subject);
      fd.append("description", description);
      fd.append("priority", priority);
      if (contractId) fd.append("contract_id", contractId);
      equipmentIds.forEach((id) => fd.append("equipment_ids", id));
      newFiles.forEach((f) => fd.append("files", f));
      const res = await portalFetch("/api/public/portal/tickets", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data?.error === "contact_not_allowed"
            ? "Seu usuário não está autorizado a abrir chamados."
            : data?.error === "file_too_large"
              ? "Arquivo acima de 10MB."
              : data?.error === "too_many_files"
                ? "Máximo de 5 arquivos."
                : "Falha ao criar chamado.";
        toast.error(msg);
        return;
      }
      toast.success(`Chamado #${data.number} criado.`);
      setSubject("");
      setDescription("");
      setPriority("medium");
      setEquipmentIds([]);
      setContractId("");
      setAvulsoConfirmed(false);
      setNewFiles([]);
      setShowForm(false);
      reload();
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          ← Voltar para meus chamados
        </Button>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground font-mono">
                #{selected.ticket.number}
              </div>
              <h2 className="text-lg font-semibold mt-0.5">{selected.ticket.subject}</h2>
              <p className="text-[11px] text-muted-foreground mt-1">
                Aberto em {new Date(selected.ticket.created_at).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PriorityBadge priority={selected.ticket.priority} />
              <TicketBadge status={selected.ticket.status} />
            </div>
          </div>
        </Card>

        {selected.equipments && selected.equipments.length > 0 && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-2">Equipamentos vinculados</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {selected.equipments.map((eq) => (
                <li key={eq.id} className="rounded-md border p-2.5 text-xs">
                  <div className="font-medium text-sm">{eq.name}</div>
                  <div className="text-muted-foreground mt-0.5">
                    {[eq.brand, eq.model].filter(Boolean).join(" ") || "-"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                    {eq.asset_tag && (
                      <span>
                        Patrimônio: <span className="font-mono">{eq.asset_tag}</span>
                      </span>
                    )}
                    {eq.serial_number && (
                      <span>
                        S/N: <span className="font-mono">{eq.serial_number}</span>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold">Andamento do atendimento</h3>
            <Button variant="ghost" size="sm" onClick={() => openTicket(selected.ticket.id)}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {selected.messages.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Sem atualizações até o momento.
            </div>
          ) : (
            <ul className="divide-y">
              {selected.messages.map((m) => (
                <li
                  key={m.id}
                  className={`px-4 py-3 ${m.author_type === "contact" ? "bg-muted/30" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{m.author_name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(m.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{m.content}</div>
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.attachments.map((a, i) =>
                        a.url ? (
                          <a
                            key={i}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
                          >
                            📎 {a.name}{" "}
                            <span className="text-muted-foreground">
                              ({Math.round(a.size / 1024)} KB)
                            </span>
                          </a>
                        ) : (
                          <span key={i} className="text-[11px] px-2 py-1 rounded border opacity-60">
                            📎 {a.name}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">Responder</h3>
          <form onSubmit={sendReply} className="space-y-2">
            <Textarea
              required
              rows={4}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Digite sua mensagem..."
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <input
                  id="reply-files"
                  type="file"
                  multiple
                  className="text-xs"
                  onChange={(e) => setReplyFiles(Array.from(e.target.files ?? []))}
                />
                {replyFiles.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {replyFiles.length} arquivo(s)
                  </span>
                )}
              </div>
              <Button type="submit" size="sm" disabled={replying || !reply.trim()}>
                {replying ? "Enviando..." : "Enviar"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Máx. 5 arquivos, 10MB cada.</p>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Olá, {session.contact.name}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {session.contact.company_name ?? "Sem empresa"}
            {" · "}
            {session.has_active_contract ? (
              <span className="text-green-600 dark:text-green-400">Contrato ativo</span>
            ) : (
              <span className="text-yellow-600 dark:text-yellow-400">Sem contrato ativo</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={reload}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {canOpen && (
            <Button
              size="sm"
              onClick={() => {
                if (showForm) {
                  setShowForm(false);
                  return;
                }
                if (session.contracts.length === 0) {
                  startTicketFlow("");
                } else {
                  setContractPicker({
                    open: true,
                    selected: session.contracts.length === 1 ? session.contracts[0].id : "",
                  });
                }
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Novo chamado
            </Button>
          )}
        </div>
      </div>

      <PortalStats tickets={session.tickets} />

      {!canOpen && (
        <Card className="p-4 border-yellow-500/40 bg-yellow-500/5 text-xs">
          Seu usuário não está autorizado a abrir chamados. Solicite ao administrador.
        </Card>
      )}

      {showForm && canOpen && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3">Novo chamado</h3>
          {selectedContract && (
            <div className="mb-3 rounded-md border bg-primary/5 p-2 text-xs">
              <div className="font-medium">Contrato: {selectedContract.name}</div>
              {selectedContract.description && (
                <div className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {selectedContract.description}
                </div>
              )}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="subject">Assunto</Label>
              <Input
                id="subject"
                required
                minLength={3}
                maxLength={500}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="priority">Prioridade</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Equipamentos relacionados</Label>
              {availableEquipments.length === 0 ? (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Nenhum equipamento cadastrado para sua empresa.
                </p>
              ) : (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                  {availableEquipments.map((eq) => (
                    <label key={eq.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={equipmentIds.includes(eq.id)}
                        onChange={() => toggleEquipment(eq.id)}
                      />
                      <span>{eq.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                required
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o problema com o máximo de detalhes."
              />
            </div>
            <div>
              <Label htmlFor="new-files">Anexos</Label>
              <input
                id="new-files"
                type="file"
                multiple
                className="text-xs block mt-1"
                onChange={(e) => setNewFiles(Array.from(e.target.files ?? []))}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {newFiles.length > 0 ? `${newFiles.length} arquivo(s) selecionado(s). ` : ""}Máx. 5
                arquivos, 10MB cada.
              </p>
            </div>
            {isAvulso && (
              <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
                <CircleDollarSign className="size-4" />
                <AlertTitle>Este atendimento será cobrado à parte</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>
                    {!session.has_active_contract
                      ? "Sua empresa não possui contrato vigente."
                      : "Um ou mais equipamentos selecionados estão fora da cobertura contratual."}
                  </p>
                  <label className="flex cursor-pointer items-start gap-2 font-medium">
                    <Checkbox
                      checked={avulsoConfirmed}
                      onCheckedChange={(checked) => setAvulsoConfirmed(checked === true)}
                    />
                    <span>Estou ciente da cobrança avulsa deste atendimento.</span>
                  </label>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting || (isAvulso && !avulsoConfirmed)}>
                {submitting ? "Enviando..." : "Abrir chamado"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Meus chamados</h3>
        </div>
        {session.tickets.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Nenhum chamado registrado.
          </div>
        ) : (
          <ul className="divide-y">
            {session.tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => openTicket(t.id)}
                  disabled={loadingDetail === t.id}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors disabled:opacity-60"
                >
                  <span className="font-mono text-xs text-muted-foreground w-14">#{t.number}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{t.subject}</div>
                    {t.pending_type && (
                      <div className="mt-0.5">
                        <PendingBadge pending={t.pending_type} />
                      </div>
                    )}
                  </div>
                  <PriorityBadge priority={t.priority} />
                  <div className="flex flex-col items-end gap-1">
                    <TicketBadge status={t.status} />
                  </div>
                  <span className="text-[11px] text-muted-foreground w-24 text-right">
                    {new Date(t.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={contractPicker.open}
        onOpenChange={(o) => setContractPicker((s) => ({ ...s, open: o }))}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Selecionar contrato</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Escolha em qual contrato ativo deseja abrir o chamado.
          </p>
          <div className="border rounded-md p-1 max-h-72 overflow-y-auto space-y-1 mt-2">
            {session.contracts.map((c) => (
              <label
                key={c.id}
                className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-2"
              >
                <input
                  type="radio"
                  name="contract-pick"
                  className="mt-1"
                  checked={contractPicker.selected === c.id}
                  onChange={() => setContractPicker((s) => ({ ...s, selected: c.id }))}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{c.name}</div>
                  {c.description && (
                    <div className="text-xs text-muted-foreground whitespace-pre-wrap mt-0.5">
                      {c.description}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {c.starts_at ?? "-"} → {c.ends_at ?? "-"}
                    {c.equipment_ids.length > 0 &&
                      ` · ${c.equipment_ids.length} equipamento(s) vinculado(s)`}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setContractPicker({ open: false, selected: "" })}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!contractPicker.selected}
              onClick={() => {
                const cid = contractPicker.selected;
                setContractPicker({ open: false, selected: "" });
                startTicketFlow(cid);
              }}
            >
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={eqPicker.open} onOpenChange={(o) => setEqPicker((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Selecionar equipamentos</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Você possui múltiplos equipamentos vinculados. Selecione quais devem ser associados ao
            chamado.
          </p>
          <div className="border rounded-md p-2 max-h-64 overflow-y-auto space-y-1 mt-2">
            {eqPicker.items.map((eq) => {
              const checked = eqPicker.selected.includes(eq.id);
              return (
                <label
                  key={eq.id}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setEqPicker((s) => ({
                        ...s,
                        selected: e.target.checked
                          ? [...s.selected, eq.id]
                          : s.selected.filter((id) => id !== eq.id),
                      }))
                    }
                  />
                  <span>{eq.name}</span>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEqPicker({ open: false, items: [], selected: [] })}
            >
              Nenhum
            </Button>
            <Button
              type="button"
              onClick={() => {
                setEquipmentIds((prev) => Array.from(new Set([...prev, ...eqPicker.selected])));
                setEqPicker({ open: false, items: [], selected: [] });
              }}
            >
              Associar selecionados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PortalStats({ tickets }: { tickets: SessionData["tickets"] }) {
  const total = tickets.length;
  const open = tickets.filter(
    (t) => t.status === "new" || t.status === "in_progress" || t.status === "pending",
  ).length;
  const inProgress = tickets.filter((t) => t.status === "in_progress").length;
  const resolved = tickets.filter((t) => t.status === "resolved" || t.status === "closed").length;
  const urgent = tickets.filter(
    (t) =>
      (t.priority === "urgent" || t.priority === "high") &&
      t.status !== "resolved" &&
      t.status !== "closed",
  ).length;

  const cards = [
    { label: "Total de chamados", value: total, icon: Inbox, tone: "text-foreground" },
    { label: "Em aberto", value: open, icon: Clock, tone: "text-blue-600 dark:text-blue-400" },
    {
      label: "Em andamento",
      value: inProgress,
      icon: RefreshCw,
      tone: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Resolvidos",
      value: resolved,
      icon: CheckCircle2,
      tone: "text-green-600 dark:text-green-400",
    },
    {
      label: "Prioritários",
      value: urgent,
      icon: AlertTriangle,
      tone: "text-red-600 dark:text-red-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card key={c.label} className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">{c.label}</span>
              <Icon className={`h-3.5 w-3.5 ${c.tone}`} />
            </div>
            <div className={`text-2xl font-semibold mt-1 ${c.tone}`}>{c.value}</div>
          </Card>
        );
      })}
    </div>
  );
}
