import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import HomeChat from "@/components/HomeChat";
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
  FileSpreadsheet,
  FileText,
  Paperclip,
  Search,
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

const ticketStatusLabels: Record<TicketStatus, string> = {
  new: "Novo",
  in_progress: "Em atendimento",
  pending: "Pendente",
  resolved: "Resolvido",
  closed: "Fechado",
};

const priorityLabels = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
} as const;

const pendingLabels: Record<Exclude<PendingType, null | undefined>, string> = {
  awaiting_customer: "Pendente de retorno do cliente",
  awaiting_tech: "Pendente de retorno técnico",
  tech_response: "Retorno técnico",
};

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
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketStatus, setTicketStatus] = useState<"all" | TicketStatus>("all");
  const [ticketPriority, setTicketPriority] = useState<
    "all" | "low" | "medium" | "high" | "urgent"
  >("all");

  const filteredTickets = useMemo(() => {
    const normalizedQuery = ticketQuery.trim().toLocaleLowerCase("pt-BR");
    return session.tickets.filter((ticket) => {
      const matchesQuery =
        !normalizedQuery ||
        String(ticket.number).includes(normalizedQuery) ||
        ticket.subject.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      const matchesStatus = ticketStatus === "all" || ticket.status === ticketStatus;
      const matchesPriority = ticketPriority === "all" || ticket.priority === ticketPriority;
      return matchesQuery && matchesStatus && matchesPriority;
    });
  }, [session.tickets, ticketPriority, ticketQuery, ticketStatus]);

  const exportRows = () =>
    filteredTickets.map((ticket) => ({
      Número: ticket.number,
      Assunto: ticket.subject,
      Status: ticketStatusLabels[ticket.status],
      Pendência: ticket.pending_type ? pendingLabels[ticket.pending_type] : "",
      Prioridade: priorityLabels[ticket.priority],
      Abertura: new Date(ticket.created_at).toLocaleString("pt-BR"),
    }));

  const exportXlsx = async () => {
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(exportRows());
      worksheet["!cols"] = [
        { wch: 12 },
        { wch: 48 },
        { wch: 18 },
        { wch: 32 },
        { wch: 14 },
        { wch: 20 },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Meus chamados");
      XLSX.writeFile(workbook, `meus-chamados-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      toast.error("Não foi possível exportar os chamados para Excel.");
    }
  };

  const exportPdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const rows = exportRows();
      const addHeader = () => {
        document.setFont("helvetica", "bold");
        document.setFontSize(15);
        document.text("Meus chamados", 14, 14);
        document.setFontSize(8);
        document.setTextColor(90);
        document.text(`Exportado em ${new Date().toLocaleString("pt-BR")}`, 14, 19);
        document.setTextColor(0);
        document.setFillColor(235, 243, 247);
        document.rect(12, 23, 273, 8, "F");
        document.setFontSize(8);
        document.text("Número", 15, 28);
        document.text("Assunto", 35, 28);
        document.text("Status", 137, 28);
        document.text("Pendência", 174, 28);
        document.text("Prioridade", 236, 28);
        document.text("Abertura", 259, 28);
      };

      addHeader();
      let y = 37;
      rows.forEach((row) => {
        if (y > 195) {
          document.addPage("a4", "landscape");
          addHeader();
          y = 37;
        }
        document.setFont("helvetica", "normal");
        document.setFontSize(8);
        const subjectLines = document.splitTextToSize(row.Assunto, 96) as string[];
        document.text(String(row.Número), 15, y);
        document.text(subjectLines, 35, y);
        document.text(row.Status, 137, y);
        document.text(row.Pendência || "-", 174, y);
        document.text(row.Prioridade, 236, y);
        document.text(row.Abertura.split(",")[0], 259, y);
        const rowHeight = Math.max(8, subjectLines.length * 4 + 3);
        document.setDrawColor(225);
        document.line(12, y + rowHeight - 3, 285, y + rowHeight - 3);
        y += rowHeight;
      });
      document.save(`meus-chamados-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch {
      toast.error("Não foi possível exportar os chamados para PDF.");
    }
  };
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
          <form onSubmit={sendReply} className="space-y-3">
            <Textarea
              required
              rows={4}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Digite sua mensagem..."
            />
            <div>
              <Label htmlFor="reply-files">Anexos</Label>
              <input
                id="reply-files"
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => setReplyFiles(Array.from(e.target.files ?? []))}
              />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" asChild>
                  <label htmlFor="reply-files" className="cursor-pointer">
                    <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                    Selecionar anexos
                  </label>
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {replyFiles.length > 0
                    ? `${replyFiles.length} arquivo(s) selecionado(s)`
                    : "Nenhum arquivo selecionado"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Máx. 5 arquivos, 10MB cada.</p>
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={replying || !reply.trim()}>
                {replying ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Button variant="ghost" size="sm" onClick={reload}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {canOpen && <HomeChat authenticatedSession={session} onTicketCreated={reload} />}
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
                className="sr-only"
                onChange={(e) => setNewFiles(Array.from(e.target.files ?? []))}
              />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button type="button" asChild>
                  <label htmlFor="new-files" className="cursor-pointer">
                    <Paperclip className="mr-2 h-4 w-4" />
                    Selecionar anexos
                  </label>
                </Button>
                <span className="text-xs text-muted-foreground">
                  {newFiles.length > 0
                    ? `${newFiles.length} arquivo(s) selecionado(s)`
                    : "Nenhum arquivo selecionado"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Máx. 5 arquivos, 10MB cada.</p>
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

      <Card className="overflow-hidden p-0">
        <div className="space-y-3 border-b px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Meus chamados</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {filteredTickets.length} de {session.tickets.length} chamado(s)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!filteredTickets.length}
                onClick={() => void exportPdf()}
              >
                <FileText className="mr-1.5 h-4 w-4" /> PDF
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!filteredTickets.length}
                onClick={() => void exportXlsx()}
              >
                <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel XLSX
              </Button>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_190px_170px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={ticketQuery}
                onChange={(event) => setTicketQuery(event.target.value)}
                className="pl-9"
                placeholder="Buscar por número ou assunto"
                aria-label="Buscar chamados"
              />
            </div>
            <Select
              value={ticketStatus}
              onValueChange={(value) => setTicketStatus(value as typeof ticketStatus)}
            >
              <SelectTrigger aria-label="Filtrar por status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(ticketStatusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={ticketPriority}
              onValueChange={(value) => setTicketPriority(value as typeof ticketPriority)}
            >
              <SelectTrigger aria-label="Filtrar por prioridade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as prioridades</SelectItem>
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {session.tickets.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Nenhum chamado registrado.
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Nenhum chamado corresponde aos filtros selecionados.
          </div>
        ) : (
          <div>
            <div className="hidden grid-cols-[4rem_minmax(0,1fr)_8rem_12rem_6rem] gap-3 border-b bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground md:grid">
              <span>Número</span>
              <span>Assunto</span>
              <span>Prioridade</span>
              <span>Status</span>
              <span className="text-right">Abertura</span>
            </div>
            <ul className="divide-y">
              {filteredTickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => openTicket(t.id)}
                    disabled={loadingDetail === t.id}
                    className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-60 md:grid-cols-[4rem_minmax(0,1fr)_8rem_12rem_6rem] md:items-center md:gap-3"
                  >
                    <span className="font-mono text-xs text-muted-foreground">#{t.number}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{t.subject}</div>
                    </div>
                    <PriorityBadge priority={t.priority} className="justify-self-start" />
                    <div className="flex flex-col items-start gap-1">
                      <TicketBadge status={t.status} />
                      <PendingBadge pending={t.pending_type} />
                    </div>
                    <span className="text-[11px] text-muted-foreground md:text-right">
                      {new Date(t.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
