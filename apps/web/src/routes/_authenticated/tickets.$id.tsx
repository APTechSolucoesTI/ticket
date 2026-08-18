import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Paperclip, Play, Printer, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChannelIcon, type TicketChannel } from "@/components/ticket/ChannelIcon";
import { PriorityBadge, type TicketPriority } from "@/components/ticket/PriorityBadge";
import { TicketBadge, type TicketStatus } from "@/components/ticket/TicketBadge";
import { PendingBadge, type PendingType } from "@/components/ticket/PendingBadge";
import { SlaTimer } from "@/components/ticket/SlaTimer";
import { cn } from "@/lib/utils";
import { maskPhone } from "@/lib/masks";
import { useServerFn } from "@tanstack/react-start";
import { notifyTicketStatus, sendCsatInvite } from "@/lib/whatsapp.functions";
import { TicketComposer } from "@/components/ticket/TicketComposer";
import { AttachmentPreview } from "@/components/ticket/AttachmentPreview";
import { FinalizeTicketDialog, type FinalReport } from "@/components/ticket/FinalizeTicketDialog";
import { useChatSocket } from "@/lib/chat-socket";
import DOMPurify from "isomorphic-dompurify";

export const Route = createFileRoute("/_authenticated/tickets/$id")({
  head: ({ params }) => ({ meta: [{ title: `Ticket #${params.id} — APTicket` }] }),
  component: TicketDetailPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">Erro: {error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm">
      Ticket não encontrado.{" "}
      <Link to="/tickets" className="text-primary underline">
        Voltar
      </Link>
    </div>
  ),
});

const SLA_DEFAULT_MIN = 240;

type Msg = {
  id: string;
  content: string;
  is_internal: boolean;
  author_type: "agent" | "contact" | "system";
  author_id: string | null;
  author_contact_id: string | null;
  channel: TicketChannel | null;
  created_at: string;
  attachments?: Array<{
    path: string;
    name: string;
    size: number;
    type: string;
    url?: string;
  }> | null;
  delivery_status?: string | null;
  authorName?: string;
};

function TicketDetailPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const chat = useChatSocket(id, () => {
    qc.invalidateQueries({ queryKey: ["messages", id] });
  });

  const {
    data: ticket,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("*, companies(id,name), contacts(id,name,email,phone)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      let assigneeName: string | undefined;
      if (data.assigned_to) {
        const { data: p } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", data.assigned_to)
          .maybeSingle();
        assigneeName = p?.name;
      }
      return { ...data, assigneeName };
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("ticket_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const agentIds = Array.from(
        new Set((data ?? []).map((m) => m.author_id).filter(Boolean)),
      ) as string[];
      const contactIds = Array.from(
        new Set((data ?? []).map((m) => m.author_contact_id).filter(Boolean)),
      ) as string[];
      const [{ data: agents }, { data: contacts }] = await Promise.all([
        agentIds.length
          ? supabase.from("profiles").select("id, name").in("id", agentIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        contactIds.length
          ? supabase.from("contacts").select("id, name").in("id", contactIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const aMap = Object.fromEntries((agents ?? []).map((a) => [a.id, a.name]));
      const cMap = Object.fromEntries((contacts ?? []).map((c) => [c.id, c.name]));
      return (data ?? []).map((m) => ({
        ...m,
        authorName: m.author_id
          ? aMap[m.author_id]
          : m.author_contact_id
            ? cMap[m.author_contact_id]
            : "Sistema",
      })) as unknown as Msg[];
    },
  });

  const { data: timeEntries = [] } = useQuery({
    queryKey: ["time_entries", id],
    queryFn: async () =>
      (
        await supabase
          .from("time_entries")
          .select("id, minutes, started_at, created_at, agent_id, description")
          .eq("ticket_id", id)
          .order("created_at", { ascending: false })
      ).data ?? [],
  });
  const totalMinutes = useMemo(
    () => timeEntries.reduce((s, t) => s + (t.minutes ?? 0), 0),
    [timeEntries],
  );

  const { data: performedServices = [] } = useQuery({
    queryKey: ["ticket_services_performed", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_services_performed")
        .select("id, complement, provided_services(description)")
        .eq("ticket_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Array<{
        id: string;
        complement: string | null;
        provided_services: { description: string } | null;
      }>;
    },
  });
  // Relatório é gerado (via trigger no banco) tanto ao resolver quanto ao
  // fechar o ticket — o botão de imprimir precisa funcionar já em "resolved".
  const isResolvedOrClosed = ticket?.status === "resolved" || ticket?.status === "closed";
  const { data: closingReport } = useQuery({
    queryKey: ["ticket_closing_report", id],
    enabled: isResolvedOrClosed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_closing_reports")
        .select("token, generated_at")
        .eq("ticket_id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [showEntries, setShowEntries] = useState(false);
  const entryUserIds = useMemo(
    () => Array.from(new Set(timeEntries.map((t) => t.agent_id).filter(Boolean) as string[])),
    [timeEntries],
  );
  const { data: entryAuthors = {} } = useQuery({
    queryKey: ["time_entries_authors", id, entryUserIds],
    enabled: entryUserIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, name").in("id", entryUserIds);
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.name])) as Record<string, string>;
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents", "options"],
    queryFn: async () =>
      (await supabase.from("profiles").select("id, name").order("name")).data ?? [],
  });
  const { data: cannedList = [] } = useQuery({
    queryKey: ["canned_responses"],
    queryFn: async () =>
      (await supabase.from("canned_responses").select("id, title, body").order("title")).data ?? [],
  });

  const { data: companyTickets = [] } = useQuery({
    queryKey: ["company_tickets", ticket?.company_id],
    enabled: !!ticket?.company_id,
    queryFn: async () =>
      (
        await supabase
          .from("tickets")
          .select("id, number, subject, status")
          .eq("company_id", ticket!.company_id!)
          .neq("id", id)
          .order("created_at", { ascending: false })
          .limit(5)
      ).data ?? [],
  });

  const { data: companyEquipments = [] } = useQuery({
    queryKey: ["company_equipments", ticket?.company_id],
    enabled: !!ticket?.company_id,
    queryFn: async () =>
      (
        await supabase
          .from("equipments")
          .select("id, name")
          .eq("company_id", ticket!.company_id!)
          .order("name")
      ).data ?? [],
  });

  const { data: linkedEquipments = [] } = useQuery({
    queryKey: ["ticket_equipments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_equipments")
        .select("equipment_id")
        .eq("ticket_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const linkedIds = useMemo(
    () => new Set(linkedEquipments.map((l) => l.equipment_id)),
    [linkedEquipments],
  );

  const toggleEquipment = useMutation({
    mutationFn: async ({ equipmentId, checked }: { equipmentId: string; checked: boolean }) => {
      if (!ticket) return;
      if (checked) {
        const { error } = await supabase.from("ticket_equipments").insert({
          tenant_id: ticket.tenant_id,
          ticket_id: id,
          equipment_id: equipmentId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("ticket_equipments")
          .delete()
          .eq("ticket_id", id)
          .eq("equipment_id", equipmentId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket_equipments", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // reply/internal state now lives inside TicketComposer
  const [pendingTime, setPendingTime] = useState<{ msgId: string } | null>(null);
  const [askResolved, setAskResolved] = useState(false);
  const [askCustomerReturn, setAskCustomerReturn] = useState(false);
  const [minutesInput, setMinutesInput] = useState("");
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState<Date | null>(null);
  const [attendance, setAttendance] = useState<"ask" | "active" | "readonly">("ask");
  const [askOpen, setAskOpen] = useState(false);
  const [finalizeStatus, setFinalizeStatus] = useState<"resolved" | "closed" | null>(null);

  // Ao abrir/fechar a tela do ticket, sempre verificar iniciar atendimento
  useEffect(() => {
    if (!ticket || !user) return;
    const finalized = ticket.status === "resolved" || ticket.status === "closed";
    if (finalized) {
      setAttendance("readonly");
      setAskOpen(false);
    } else {
      setAttendance("ask");
      setAskOpen(true);
    }
    return () => {
      setAskOpen(false);
      setAttendance("ask");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, ticket?.status, user?.id]);

  const isFinalized = ticket?.status === "resolved" || ticket?.status === "closed";
  const readOnly = attendance === "readonly" || isFinalized;

  const startAttendance = async () => {
    if (!ticket || !user) return;
    try {
      const { error } = await supabase
        .from("tickets")
        .update({ assigned_to: user.id, status: "in_progress", resolved_at: null, closed_at: null })
        .eq("id", id);
      if (error) throw error;
      setTimerStartedAt(new Date());
      setTimerRunning(true);
      setAttendance("active");
      setAskOpen(false);
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      toast.success("Atendimento iniciado — cronômetro em execução");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const declineAttendance = () => {
    setAttendance("readonly");
    setAskOpen(false);
    toast.info("Ticket aberto em modo somente leitura");
  };

  const [navigateAfterSave, setNavigateAfterSave] = useState(false);
  const handleBack = () => {
    if (timerRunning && timerStartedAt) {
      const elapsedMin = Math.max(1, Math.round((Date.now() - timerStartedAt.getTime()) / 60_000));
      setTimerRunning(false);
      setMinutesInput(String(elapsedMin));
      setPendingTime({ msgId: "timer" });
      setNavigateAfterSave(true);
      toast.success(`Cronômetro parado (${elapsedMin} min)`);
      return;
    }
    navigate({ to: "/tickets" });
  };

  const notifyStatus = useServerFn(notifyTicketStatus);
  const inviteCsat = useServerFn(sendCsatInvite);

  const updateTicket = useMutation({
    mutationFn: async (
      patch: Partial<{
        status: TicketStatus;
        assigned_to: string | null;
        pending_type: PendingType;
        resolution_summary: string;
        resolution_diagnosis: string;
        services: Array<{ provided_service_id: string; complement: string }>;
      }>,
    ) => {
      const { services, ...rest } = patch;
      const full: Partial<{
        status: TicketStatus;
        assigned_to: string | null;
        pending_type: PendingType;
        resolution_summary: string;
        resolution_diagnosis: string;
        resolved_at: string | null;
        closed_at: string | null;
      }> = { ...rest };
      if (patch.status === "resolved") full.resolved_at = new Date().toISOString();
      if (patch.status === "closed") full.closed_at = new Date().toISOString();
      if (patch.status && patch.status !== "resolved" && patch.status !== "closed") {
        full.resolved_at = null;
        full.closed_at = null;
      }
      const { error } = await supabase.from("tickets").update(full).eq("id", id);
      if (error) throw error;

      if (services?.length && ticket) {
        const rows = services.map((s) => ({
          tenant_id: ticket.tenant_id,
          ticket_id: id,
          provided_service_id: s.provided_service_id,
          complement: s.complement || null,
          created_by: user?.id ?? null,
        }));
        const { error: svcErr } = await supabase.from("ticket_services_performed").insert(rows);
        if (svcErr) throw svcErr;
      }

      // Fire-and-forget WhatsApp notifications on status change
      if (patch.status && ticket?.channel === "whatsapp") {
        try {
          await notifyStatus({ data: { ticket_id: id, status: patch.status } });
          if (patch.status === "resolved") {
            await inviteCsat({ data: { ticket_id: id } });
          }
        } catch (e) {
          console.warn("WhatsApp notification failed", e);
        }
      }
    },
    onSuccess: () => {
      toast.success("Ticket atualizado");
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket_services_performed", id] });
      qc.invalidateQueries({ queryKey: ["ticket_closing_report", id] });
      setFinalizeStatus(null);
      if (navigateAfterSave) {
        setNavigateAfterSave(false);
        navigate({ to: "/tickets" });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Resolver/fechar exige laudo final (resumo + diagnóstico) — a menos que o
  // ticket já tenha um (ex: indo de "resolvido" pra "fechado" sem reabrir).
  const requestStatusChange = (status: TicketStatus) => {
    const needsReport =
      (status === "resolved" || status === "closed") && !ticket?.resolution_summary?.trim();
    if (needsReport) {
      setFinalizeStatus(status as "resolved" | "closed");
    } else {
      updateTicket.mutate({ status });
    }
  };

  const submitFinalReport = (report: FinalReport) => {
    if (!finalizeStatus) return;
    updateTicket.mutate({ status: finalizeStatus, ...report });
  };

  const applyTemplate = (body: string) => {
    return body
      .replaceAll("{{contato}}", ticket?.contacts?.name ?? "")
      .replaceAll("{{cliente}}", ticket?.companies?.name ?? "")
      .replaceAll("{{ticket}}", `#${ticket?.number ?? ""}`)
      .replaceAll("{{assunto}}", ticket?.subject ?? "")
      .replaceAll("{{agente}}", user?.user_metadata?.name ?? user?.email ?? "");
  };

  const handleComposerPublicSent = () => {
    if (!timerRunning) setPendingTime({ msgId: "composer" });
    setAskCustomerReturn(true);
  };

  const saveTime = useMutation({
    mutationFn: async () => {
      const n = parseInt(minutesInput || "0", 10);
      if (!n || !ticket) return;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sem usuário");
      const endedAt = new Date();
      const startedAt = timerStartedAt ?? new Date(endedAt.getTime() - n * 60_000);
      const { error } = await supabase.from("time_entries").insert({
        tenant_id: ticket.tenant_id,
        ticket_id: id,
        agent_id: u.user.id,
        minutes: n,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${minutesInput} minutos apontados`);
      const wasTimer = pendingTime?.msgId === "timer";
      setMinutesInput("");
      setPendingTime(null);
      setTimerStartedAt(null);
      qc.invalidateQueries({ queryKey: ["time_entries", id] });
      if (wasTimer) {
        setAskResolved(true);
      } else if (navigateAfterSave) {
        setNavigateAfterSave(false);
        navigate({ to: "/tickets" });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;
  if (error || !ticket)
    return <div className="p-6 text-sm text-destructive">Ticket não encontrado.</div>;

  const due =
    ticket.sla_resolution_due_at ??
    new Date(new Date(ticket.created_at).getTime() + SLA_DEFAULT_MIN * 60_000).toISOString();

  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_360px]">
        {/* Timeline */}
        <div className="flex flex-col overflow-hidden border-r">
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <button
              onClick={handleBack}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-xs text-muted-foreground">#{ticket.number}</span>
            <h1 className="text-sm font-semibold">{ticket.subject}</h1>
            {readOnly && (
              <span className="ml-2 rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Somente leitura
              </span>
            )}
          </div>
          <div className="flex-1 space-y-3 overflow-auto p-4">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda.</p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-md border p-3 text-xs",
                  m.is_internal
                    ? "border-yellow-500/40 bg-yellow-500/10"
                    : m.author_type === "agent"
                      ? "border-blue-500/30 bg-blue-500/5"
                      : "bg-muted/40",
                )}
              >
                <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    {m.channel && <ChannelIcon channel={m.channel} />}
                    <span className="font-medium text-foreground">{m.authorName ?? "—"}</span>
                    {m.is_internal && (
                      <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-800 dark:text-yellow-300">
                        Nota interna
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>{new Date(m.created_at).toLocaleString("pt-BR")}</span>
                    {m.author_type === "agent" && m.channel === "whatsapp" && m.delivery_status && (
                      <span
                        title={`Status: ${m.delivery_status}`}
                        className={cn(
                          "font-mono",
                          m.delivery_status === "failed" && "text-red-500",
                          m.delivery_status === "read" && "text-blue-500",
                          m.delivery_status === "delivered" && "text-foreground/70",
                        )}
                      >
                        {m.delivery_status === "failed"
                          ? "⚠"
                          : m.delivery_status === "read"
                            ? "✓✓"
                            : m.delivery_status === "delivered"
                              ? "✓✓"
                              : "✓"}
                      </span>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.attachments.map((a, i) => (
                      <AttachmentPreview key={i} a={a} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {readOnly ? (
            <div className="border-t bg-muted/30 p-3 text-center text-xs text-muted-foreground">
              {isFinalized ? (
                <>
                  Ticket {ticket?.status === "closed" ? "fechado" : "resolvido"} — somente leitura.
                </>
              ) : (
                <>
                  Modo somente leitura — inicie o atendimento para interagir com este ticket.
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setAskOpen(true)}
                    >
                      Iniciar atendimento
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <TicketComposer
              ticketId={id}
              tenantId={ticket.tenant_id}
              channel={ticket.channel}
              agentName={
                (user?.user_metadata as { name?: string } | undefined)?.name ?? user?.email ?? ""
              }
              cannedList={cannedList}
              applyTemplate={applyTemplate}
              onSent={() => {
                qc.invalidateQueries({ queryKey: ["messages", id] });
                qc.invalidateQueries({ queryKey: ["tickets"] });
                qc.invalidateQueries({ queryKey: ["ticket", id] });
              }}
              onPublicSent={handleComposerPublicSent}
              onSendChat={ticket.channel === "chat" ? chat.sendMessage : undefined}
              onTyping={ticket.channel === "chat" ? chat.setTyping : undefined}
            />
          )}
          {ticket.channel === "chat" && chat.typingUsers.size > 0 && (
            <p className="px-3 pb-1 text-xs italic text-muted-foreground">Digitando…</p>
          )}
        </div>

        {/* Sidebar */}
        <aside className="overflow-auto bg-muted/20 p-3">
          <Card>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-3 pt-0 text-sm">
              <div className="font-medium">{ticket.contacts?.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{ticket.companies?.name ?? "—"}</div>
              {ticket.contacts?.email && (
                <div className="mt-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-primary/80">
                    E-mail
                  </div>
                  <a
                    href={`mailto:${ticket.contacts.email}`}
                    className="text-xs font-medium text-primary hover:underline break-all"
                  >
                    {ticket.contacts.email}
                  </a>
                </div>
              )}
              {ticket.contacts?.phone && (
                <div className="text-xs">
                  <a href={`tel:${ticket.contacts.phone}`} className="text-primary hover:underline">
                    {maskPhone(ticket.contacts.phone)}
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          {ticket.resolution_summary?.trim() && (
            <Card className="mt-3">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground">
                  Laudo final
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-3 pt-0 text-xs">
                <div>
                  <div className="mb-0.5 font-medium text-foreground">Assunto/Solicitação</div>
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {ticket.resolution_summary}
                  </p>
                </div>
                <div>
                  <div className="mb-0.5 font-medium text-foreground">Diagnóstico das ações</div>
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground [&_p]:my-1"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(ticket.resolution_diagnosis ?? "", {
                        ALLOWED_TAGS: [
                          "p",
                          "br",
                          "strong",
                          "em",
                          "u",
                          "s",
                          "a",
                          "ul",
                          "ol",
                          "li",
                          "h1",
                          "h2",
                          "h3",
                          "blockquote",
                          "code",
                          "pre",
                        ],
                        ALLOWED_ATTR: ["href", "target", "rel"],
                        ALLOW_DATA_ATTR: false,
                      }),
                    }}
                  />
                </div>
                {performedServices.length > 0 && (
                  <div>
                    <div className="mb-0.5 font-medium text-foreground">Serviços executados</div>
                    <ul className="space-y-1.5">
                      {performedServices.map((s) => (
                        <li key={s.id} className="rounded-md border bg-muted/30 p-1.5">
                          <div className="font-medium text-foreground">
                            {s.provided_services?.description ?? "—"}
                          </div>
                          {s.complement && (
                            <div className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                              {s.complement}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isResolvedOrClosed && (
            <Card className="mt-3">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground">
                  Relatório do atendimento
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-3 pt-0 text-xs">
                {closingReport ? (
                  <>
                    <p className="text-muted-foreground">
                      Gerado em {new Date(closingReport.generated_at).toLocaleString("pt-BR")}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 gap-1 text-xs"
                        onClick={() =>
                          window.open(
                            `/report/${closingReport.token}?print=1`,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Imprimir
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 text-xs"
                        onClick={() =>
                          window.open(
                            `/report/${closingReport.token}`,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        Abrir relatório
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-full text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `${window.location.origin}/report/${closingReport.token}`,
                        );
                        toast.success("Link copiado");
                      }}
                    >
                      Copiar link
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">Gerando…</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="mt-3">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">SLA</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <SlaTimer
                dueAt={due}
                totalMinutes={SLA_DEFAULT_MIN}
                className="text-2xl"
                stoppedAt={ticket.resolved_at ?? ticket.closed_at ?? null}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Tempo até estouro</p>
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">Detalhes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3 pt-0 text-xs">
              <Row label="Status">
                <select
                  value={ticket.status}
                  disabled={readOnly}
                  onChange={(e) => requestStatusChange(e.target.value as TicketStatus)}
                  className="h-6 rounded-md border bg-background px-1 text-xs disabled:opacity-50"
                >
                  <option value="new">Novo</option>
                  <option value="in_progress">Em atendimento</option>
                  <option value="pending">Pendente</option>
                  <option value="resolved">Resolvido</option>
                  <option value="closed">Fechado</option>
                </select>
              </Row>
              <Row label="Atual">
                <TicketBadge status={ticket.status as TicketStatus} />
              </Row>
              {ticket.pending_type && (
                <Row label="Situação">
                  <PendingBadge pending={ticket.pending_type as PendingType} />
                </Row>
              )}
              <Row label="Técnico">
                <select
                  value={ticket.assigned_to ?? ""}
                  disabled={readOnly}
                  onChange={(e) => updateTicket.mutate({ assigned_to: e.target.value || null })}
                  className="h-6 rounded-md border bg-background px-1 text-xs disabled:opacity-50"
                >
                  <option value="">Não atribuído</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Prioridade">
                <PriorityBadge priority={ticket.priority as TicketPriority} />
              </Row>
              <Row label="Canal">
                <ChannelIcon channel={ticket.channel as TicketChannel} withLabel />
              </Row>
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">
                Time Tracking
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3 pt-0 text-xs">
              <div className="flex items-center justify-between">
                <span>Total apontado</span>
                <span className="font-mono">{totalMinutes} min</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={timerRunning ? "destructive" : "default"}
                  className="h-7 flex-1 gap-1 text-xs"
                  disabled={readOnly}
                  onClick={() => {
                    if (timerRunning) {
                      const elapsedMin = timerStartedAt
                        ? Math.max(1, Math.round((Date.now() - timerStartedAt.getTime()) / 60_000))
                        : 0;
                      setTimerRunning(false);
                      setTimerStartedAt(null);
                      if (elapsedMin > 0) {
                        setMinutesInput(String(elapsedMin));
                        setPendingTime({ msgId: "timer" });
                      }
                      toast.success(`Cronômetro parado (${elapsedMin} min)`);
                    } else {
                      setTimerStartedAt(new Date());
                      setTimerRunning(true);
                      toast.success("Cronômetro iniciado");
                    }
                  }}
                >
                  <Play className="h-3 w-3" /> {timerRunning ? "Parar" : "Iniciar"}
                </Button>
                <input
                  type="number"
                  placeholder="min"
                  value={minutesInput}
                  onChange={(e) => setMinutesInput(e.target.value)}
                  disabled={readOnly}
                  className="h-7 w-16 rounded-md border bg-background px-2 text-xs disabled:opacity-50"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => saveTime.mutate()}
                  disabled={saveTime.isPending || readOnly}
                >
                  Apontar
                </Button>
              </div>
              <button
                type="button"
                onClick={() => setShowEntries(true)}
                className="text-[11px] text-primary underline-offset-2 hover:underline"
              >
                Consultar apontamentos ({timeEntries.length})
              </button>
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">
                Equipamentos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3 pt-0 text-xs">
              {linkedEquipments.length > 0 && (
                <div className="space-y-1">
                  {linkedEquipments.map((l) => {
                    const eq = companyEquipments.find((e) => e.id === l.equipment_id);
                    return (
                      <div key={l.equipment_id} className="rounded-md border bg-muted/40 px-2 py-1">
                        {eq?.name ?? l.equipment_id}
                      </div>
                    );
                  })}
                </div>
              )}
              {companyEquipments.length === 0 ? (
                <p className="text-muted-foreground">
                  Nenhum equipamento cadastrado para o cliente.
                </p>
              ) : (
                <div>
                  <p className="mb-1 text-[10px] uppercase text-muted-foreground">
                    Vincular / desvincular
                  </p>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {companyEquipments.map((eq) => {
                      const checked = linkedIds.has(eq.id);
                      return (
                        <label
                          key={eq.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={toggleEquipment.isPending || readOnly}
                            onChange={(e) =>
                              toggleEquipment.mutate({
                                equipmentId: eq.id,
                                checked: e.target.checked,
                              })
                            }
                          />
                          <span>{eq.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <Link
                    to="/equipments"
                    className="mt-2 inline-block text-[11px] text-primary underline"
                  >
                    + Cadastrar novo equipamento
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">
                Últimos tickets do cliente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-3 pt-0 text-xs">
              {companyTickets.length === 0 && (
                <p className="text-muted-foreground">Sem outros tickets.</p>
              )}
              {companyTickets.map((t) => (
                <Link
                  key={t.id}
                  to="/tickets/$id"
                  params={{ id: t.id }}
                  onClick={() => router.invalidate()}
                  className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-accent"
                >
                  <span className="truncate">
                    <span className="font-mono text-muted-foreground">#{t.number}</span> {t.subject}
                  </span>
                  <TicketBadge status={t.status as TicketStatus} />
                </Link>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>

      {pendingTime && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[360px] rounded-lg border bg-background p-4 shadow-lg">
            <h3 className="text-sm font-semibold">Apontar tempo</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Quanto tempo você gastou nessa interação? (em minutos)
            </p>
            <input
              autoFocus
              type="number"
              value={minutesInput}
              onChange={(e) => setMinutesInput(e.target.value)}
              className="mt-3 h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="ex: 15"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const wasTimer = pendingTime?.msgId === "timer";
                  setPendingTime(null);
                  setTimerStartedAt(null);
                  setMinutesInput("");
                  if (wasTimer) setAskResolved(true);
                  else if (navigateAfterSave) {
                    setNavigateAfterSave(false);
                    navigate({ to: "/tickets" });
                  }
                }}
              >
                Ignorar
              </Button>
              <Button size="sm" onClick={() => saveTime.mutate()} disabled={saveTime.isPending}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {askCustomerReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[400px] rounded-lg border bg-background p-4 shadow-lg">
            <h3 className="text-sm font-semibold">Retorno do cliente</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              É necessário aguardar um retorno do cliente para esta resposta?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  updateTicket.mutate({ pending_type: "tech_response" });
                  setAskCustomerReturn(false);
                }}
              >
                Não — Retorno Técnico
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  updateTicket.mutate({ pending_type: "awaiting_customer" });
                  setAskCustomerReturn(false);
                }}
              >
                Sim — Aguardar Cliente
              </Button>
            </div>
          </div>
        </div>
      )}

      {askResolved && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[400px] rounded-lg border bg-background p-4 shadow-lg">
            <h3 className="text-sm font-semibold">Ticket resolvido?</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              O atendimento foi concluído e o ticket já pode ser marcado como resolvido?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  updateTicket.mutate({ status: "pending" });
                  setAskResolved(false);
                  if (navigateAfterSave) {
                    setNavigateAfterSave(false);
                    navigate({ to: "/tickets" });
                  }
                }}
              >
                Não — Pendente
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setAskResolved(false);
                  requestStatusChange("resolved");
                }}
              >
                Sim — Resolvido
              </Button>
            </div>
          </div>
        </div>
      )}

      {finalizeStatus && (
        <FinalizeTicketDialog
          status={finalizeStatus}
          ticketSubject={ticket.subject}
          submitting={updateTicket.isPending}
          onCancel={() => setFinalizeStatus(null)}
          onConfirm={submitFinalReport}
        />
      )}

      {showEntries && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowEntries(false)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Apontamentos do ticket</h3>
              <span className="text-xs text-muted-foreground">
                Total: <span className="font-mono">{totalMinutes} min</span>
              </span>
            </div>
            <div className="max-h-[60vh] overflow-auto p-4">
              {timeEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum apontamento registrado.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-2">Início</th>
                      <th className="py-2 pr-2">Fim</th>
                      <th className="py-2 pr-2 text-right">Minutos</th>
                      <th className="py-2 pr-2">Técnico</th>
                      <th className="py-2">Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeEntries.map((t) => (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="py-2 pr-2 font-mono">
                          {t.started_at ? new Date(t.started_at).toLocaleString("pt-BR") : "—"}
                        </td>
                        <td className="py-2 pr-2 font-mono">
                          {new Date(t.created_at).toLocaleString("pt-BR")}
                        </td>
                        <td className="py-2 pr-2 text-right font-mono">{t.minutes}</td>
                        <td className="py-2 pr-2">
                          {t.agent_id ? (entryAuthors[t.agent_id] ?? "—") : "—"}
                        </td>
                        <td className="py-2">{t.description ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-end border-t px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => setShowEntries(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {askOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[400px] rounded-lg border bg-background p-4 shadow-lg">
            <h3 className="text-sm font-semibold">Iniciar atendimento?</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Deseja iniciar o atendimento deste ticket? Você será atribuído como técnico e o
              cronômetro do Time Tracking será iniciado automaticamente.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={declineAttendance}>
                Não (somente leitura)
              </Button>
              <Button size="sm" onClick={startAttendance}>
                Sim, iniciar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
