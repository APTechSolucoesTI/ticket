import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/session";
import { getMyTenantId } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import type { TicketChannel } from "@/components/ticket/ChannelIcon";
import type { TicketPriority } from "@/components/ticket/PriorityBadge";
import type { TicketStatus } from "@/components/ticket/TicketBadge";
import { toast } from "sonner";
import { TicketAutoRefresh } from "@/components/ticket/TicketAutoRefresh";
import { useModulePermissions } from "@/lib/permission-ui";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TicketOverview } from "@/components/ticket/inbox/TicketOverview";
import { TicketFilters, type TicketFilterState } from "@/components/ticket/inbox/TicketFilters";
import { TicketInboxList, TicketPagination } from "@/components/ticket/inbox/TicketInboxList";
import { TicketInboxKanban } from "@/components/ticket/inbox/TicketInboxKanban";
import { useTicketsInboxData } from "@/hooks/use-tickets-inbox";
import { calculateTicketSummary } from "@/lib/ticket-inbox";

export const Route = createFileRoute("/_authenticated/tickets")({
  head: () => ({ meta: [{ title: "Tickets - APTicket" }] }),
  component: TicketsLayout,
});

function TicketsLayout() {
  const matchRoute = useMatchRoute();
  const isDetail = matchRoute({ to: "/tickets/$id" });
  if (isDetail) return <Outlet />;
  return <TicketsInbox />;
}

function TicketsInbox() {
  const access = useModulePermissions("tickets");
  const emailQueueAccess = useModulePermissions("fila_email");
  const whatsappQueueAccess = useModulePermissions("fila_whatsapp");
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "kanban">("list");
  const [filters, setFilters] = useState<TicketFilterState>({
    status: ["new", "in_progress", "pending"],
    priority: [],
    assignee: [],
    channel: [],
    department: [],
    search: "",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openNew, setOpenNew] = useState(false);
  const filterRef = useRef<HTMLButtonElement>(null);

  const { ticketsQuery, departmentsQuery, agentsQuery, queueSummaryQuery } = useTicketsInboxData({
    canViewEmailQueue: emailQueueAccess.view,
    canViewWhatsappQueue: whatsappQueueAccess.view,
  });
  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const departments = departmentsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        filterRef.current?.focus();
      }
      if (e.key.toLowerCase() === "n" && access.create) {
        e.preventDefault();
        setOpenNew(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [access.create]);

  const summary = useMemo(() => calculateTicketSummary(tickets), [tickets]);

  const filtered = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (filters.status.length === 0 || filters.status.includes(t.status)) &&
          (filters.priority.length === 0 || filters.priority.includes(t.priority)) &&
          (filters.assignee.length === 0 ||
            (t.assigned_to !== null && filters.assignee.includes(t.assigned_to))) &&
          (filters.channel.length === 0 || filters.channel.includes(t.channel)) &&
          (filters.department.length === 0 ||
            (t.department_id !== null && filters.department.includes(t.department_id))) &&
          (!filters.search ||
            `${t.number} ${t.subject} ${t.companies?.name ?? ""}`
              .toLowerCase()
              .includes(filters.search.toLowerCase())),
      ),
    [tickets, filters],
  );

  const hasActiveFilters =
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.assignee.length > 0 ||
    filters.channel.length > 0 ||
    filters.department.length > 0 ||
    filters.search.trim().length > 0;
  const hasFilteredOutTickets = tickets.length > 0 && hasActiveFilters;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedTickets = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  useEffect(() => setPage(1), [filters, pageSize]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const resetFilters = () => {
    setFilters({
      status: [],
      priority: [],
      assignee: [],
      channel: [],
      department: [],
      search: "",
    });
  };

  return (
    <div className="flex h-full flex-col">
      <TicketOverview
        summary={summary}
        loading={ticketsQuery.isLoading}
        hasError={ticketsQuery.isError}
        queueSummary={queueSummaryQuery.data}
        queueLoading={queueSummaryQuery.isLoading}
        canViewEmailQueue={emailQueueAccess.view}
        canViewWhatsappQueue={whatsappQueueAccess.view}
      />

      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <TicketAutoRefresh
          onRefresh={() => {
            qc.invalidateQueries({ queryKey: ["tickets"] });
            qc.invalidateQueries({ queryKey: ["ticket-queue-summary"] });
          }}
        />
        <div className="min-w-0 flex-1">
          <TicketFilters
            filters={filters}
            onFiltersChange={setFilters}
            departments={departments}
            agents={agents}
            view={view}
            onViewChange={setView}
            canCreate={access.create}
            onCreate={() => setOpenNew(true)}
            triggerRef={filterRef}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {ticketsQuery.isLoading ? (
          <LoadingState label="Carregando tickets…" />
        ) : ticketsQuery.isError ? (
          <ErrorState
            title="Não foi possível carregar os tickets"
            description={
              ticketsQuery.error instanceof Error
                ? `${ticketsQuery.error.message}. Verifique sua conexão e tente novamente.`
                : "Verifique sua conexão e tente novamente."
            }
            action={{ label: "Tentar novamente", onClick: () => void ticketsQuery.refetch() }}
            className="mt-6"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={
              hasFilteredOutTickets
                ? "Nenhum ticket corresponde aos filtros"
                : "Nenhum ticket cadastrado"
            }
            description={
              hasFilteredOutTickets
                ? "Remova filtros ou altere a busca para ampliar os resultados."
                : "Crie o primeiro ticket para iniciar o atendimento deste tenant."
            }
            action={
              hasFilteredOutTickets
                ? { label: "Limpar filtros", onClick: resetFilters }
                : access.create
                  ? { label: "Criar ticket", onClick: () => setOpenNew(true) }
                  : undefined
            }
            className="mt-6"
          />
        ) : view === "list" ? (
          <TicketInboxList tickets={paginatedTickets} />
        ) : (
          <TicketInboxKanban tickets={filtered} />
        )}
      </div>
      {view === "list" &&
        !ticketsQuery.isLoading &&
        !ticketsQuery.isError &&
        filtered.length > 0 && (
          <TicketPagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      <div
        className="border-t bg-muted/40 px-3 py-1 text-[10px] text-muted-foreground"
        aria-live="polite"
      >
        {filtered.length} ticket(s) exibido(s) · Atalhos:{" "}
        {access.create && (
          <>
            <kbd className="rounded border px-1">N</kbd> novo ·{" "}
          </>
        )}
        <kbd className="rounded border px-1">F</kbd> filtros
      </div>

      {access.create && <TicketDialog open={openNew} onOpenChange={setOpenNew} />}
    </div>
  );
}

// ============== New Ticket Dialog (reused from previous implementation) ==============

const NONE = "__none__";
const schema = z.object({
  subject: z.string().trim().min(3, "Assunto obrigatório").max(200),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  status: z.enum(["new", "in_progress", "pending", "resolved", "closed"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  channel: z.enum(["email", "whatsapp", "chat", "manual", "portal"]),
  company_id: z.string().uuid("Selecione o cliente"),
  contact_id: z.string().uuid().nullable(),
  contract_id: z.string().uuid("Cliente sem contrato ativo - cadastre um contrato antes."),
  department_id: z.string().uuid().nullable(),
  assigned_to: z.string().uuid().nullable(),
  equipment_ids: z.array(z.string().uuid()).default([]),
});

function TicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    subject: "",
    description: "",
    status: "new" as TicketStatus,
    priority: "medium" as TicketPriority,
    channel: "manual" as TicketChannel,
    company_id: "",
    contact_id: "",
    contract_id: "",
    department_id: "",
    assigned_to: "",
    equipment_ids: [] as string[],
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      subject: "",
      description: "",
      status: "new",
      priority: "medium",
      channel: "manual",
      company_id: "",
      contact_id: "",
      contract_id: "",
      department_id: "",
      assigned_to: "",
      equipment_ids: [],
    });
  }, [open]);

  const { data: companies, isLoading: companiesLoading } = useQuery({
    queryKey: ["companies", "options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", "options", form.company_id],
    enabled: !!form.company_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name")
        .eq("company_id", form.company_id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const {
    data: contracts,
    isLoading: contractsLoading,
    isError: contractsError,
    refetch: refetchContracts,
  } = useQuery({
    queryKey: ["contracts", "active", form.company_id],
    enabled: !!form.company_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select(
          "id, status, starts_at, ends_at, description, includes_remote, includes_lab, includes_onsite, contract_equipments(equipment_id), contract_types(name)",
        )
        .eq("company_id", form.company_id)
        .eq("status", "active")
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).filter((c) => c.includes_remote || c.includes_lab || c.includes_onsite);
    },
  });
  const selectedContract = contracts?.find((c) => c.id === form.contract_id) as
    { description?: string | null; contract_equipments?: { equipment_id: string }[] } | undefined;
  const allowedEquipmentIds =
    selectedContract?.contract_equipments?.map((e) => e.equipment_id) ?? [];
  const contractRestrictsEquipments = allowedEquipmentIds.length > 0;
  const { data: departments } = useQuery({
    queryKey: ["departments", "options"],
    queryFn: async () =>
      (await supabase.from("departments").select("id, name").order("name")).data ?? [],
  });
  const { data: agents } = useQuery({
    queryKey: ["agents", "options"],
    queryFn: async () =>
      (await supabase.from("profiles").select("id, name").order("name")).data ?? [],
  });
  const { data: equipmentsRaw } = useQuery({
    queryKey: ["equipments", "options", form.company_id],
    enabled: !!form.company_id,
    queryFn: async () =>
      (
        await supabase
          .from("equipments")
          .select("id, name, contact_id")
          .eq("company_id", form.company_id)
          .order("name")
      ).data ?? [],
  });
  const equipments = contractRestrictsEquipments
    ? (equipmentsRaw ?? []).filter((e) => allowedEquipmentIds.includes(e.id))
    : equipmentsRaw;

  // Ao trocar o contato, se houver equipamentos vinculados a ele, perguntar/selecionar
  const promptedContactRef = useRef<string>("");
  const [eqPicker, setEqPicker] = useState<{
    open: boolean;
    items: { id: string; name: string }[];
    selected: string[];
  }>({ open: false, items: [], selected: [] });
  useEffect(() => {
    if (!form.contact_id || !equipments?.length) return;
    if (promptedContactRef.current === form.contact_id + "|" + form.contract_id) return;
    const linked = equipments.filter((e) => e.contact_id === form.contact_id);
    if (linked.length === 0) return;
    promptedContactRef.current = form.contact_id + "|" + form.contract_id;
    if (linked.length === 1) {
      const only = linked[0];
      if (
        window.confirm(
          `Este contato possui o equipamento vinculado:\n\n• ${only.name}\n\nDeseja associar ao ticket?`,
        )
      ) {
        setForm((f) => ({
          ...f,
          equipment_ids: Array.from(new Set([...f.equipment_ids, only.id])),
        }));
      }
      return;
    }
    setEqPicker({
      open: true,
      items: linked.map((e) => ({ id: e.id, name: e.name })),
      selected: linked.map((e) => e.id),
    });
  }, [form.contact_id, form.contract_id, equipments]);

  // Ao trocar o contrato, remover equipamentos selecionados que não pertencem ao contrato
  useEffect(() => {
    if (!contractRestrictsEquipments) return;
    setForm((f) => {
      const filtered = f.equipment_ids.filter((id) => allowedEquipmentIds.includes(id));
      return filtered.length === f.equipment_ids.length ? f : { ...f, equipment_ids: filtered };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.contract_id]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof schema>) => {
      const _tid = await getMyTenantId();
      if (!_tid) throw new Error("Tenant não encontrado");
      const prof = { tenant_id: _tid };
      if (!prof?.tenant_id) throw new Error("Tenant não encontrado");
      const values = {
        subject: payload.subject,
        status: payload.status,
        priority: payload.priority,
        channel: payload.channel,
        company_id: payload.company_id,
        contact_id: payload.contact_id,
        contract_id: payload.contract_id,
        department_id: payload.department_id,
        assigned_to: payload.assigned_to,
        equipment_id: payload.equipment_ids[0] ?? null,
      };
      const { data: ticket, error } = await supabase
        .from("tickets")
        .insert({ ...values, tenant_id: prof.tenant_id })
        .select("id")
        .single();
      if (error) throw error;
      if (ticket && payload.equipment_ids.length > 0) {
        const rows = payload.equipment_ids.map((eid) => ({
          ticket_id: ticket.id,
          equipment_id: eid,
          tenant_id: prof.tenant_id,
        }));
        const { error: eqErr } = await supabase.from("ticket_equipments").insert(rows);
        if (eqErr) throw eqErr;
      }
      if (payload.description && ticket) {
        await supabase.from("messages").insert({
          tenant_id: prof.tenant_id,
          ticket_id: ticket.id,
          content: payload.description,
          author_id: getCurrentUserId(),
          author_type: "agent",
          is_internal: false,
        });
      }
    },
    onSuccess: () => {
      toast.success("Ticket criado");
      qc.invalidateQueries({ queryKey: ["tickets"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo ticket</DialogTitle>
          </DialogHeader>
          <form
            className="grid grid-cols-3 gap-3"
            aria-busy={save.isPending}
            onSubmit={(e) => {
              e.preventDefault();
              const r = schema.safeParse({
                ...form,
                contact_id: form.contact_id || null,
                department_id: form.department_id || null,
                assigned_to: form.assigned_to || null,
                equipment_ids: form.equipment_ids,
              });
              if (!r.success) {
                toast.error(r.error.issues[0].message);
                return;
              }
              save.mutate(r.data);
            }}
          >
            <div className="col-span-3">
              <Label htmlFor="new-ticket-subject">Assunto *</Label>
              <Input
                id="new-ticket-subject"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="new-ticket-company">Cliente *</Label>
              <Select
                value={form.company_id}
                onValueChange={(v) =>
                  setForm({ ...form, company_id: v, contact_id: "", contract_id: "" })
                }
              >
                <SelectTrigger id="new-ticket-company" aria-busy={companiesLoading}>
                  <SelectValue
                    placeholder={companiesLoading ? "Carregando clientes…" : "Selecione…"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {companies?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="new-ticket-contract">Contrato ativo *</Label>
              <Select
                value={form.contract_id}
                onValueChange={(v) => setForm({ ...form, contract_id: v })}
                disabled={!form.company_id || contractsLoading || contractsError}
              >
                <SelectTrigger id="new-ticket-contract" aria-busy={contractsLoading}>
                  <SelectValue
                    placeholder={
                      !form.company_id
                        ? "Selecione o cliente antes"
                        : contractsLoading
                          ? "Consultando contratos ativos…"
                          : !contracts?.length
                            ? "Sem contrato ativo com suporte técnico"
                            : "Selecione…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {contracts?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c.contract_types as { name: string } | null)?.name ?? "Contrato"}
                      {c.description ? ` - ${c.description.slice(0, 60)}` : ""} ({c.starts_at} →{" "}
                      {c.ends_at})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.company_id && contractsError && (
                <Alert variant="destructive" className="mt-2 py-2">
                  <AlertTitle>Falha ao consultar contratos</AlertTitle>
                  <AlertDescription className="flex items-center justify-between gap-3 text-xs">
                    <span>Não foi possível validar se cliente possui contrato ativo.</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0"
                      onClick={() => void refetchContracts()}
                    >
                      Tentar novamente
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {form.company_id && !contractsLoading && !contractsError && !contracts?.length && (
                <Alert variant="destructive" className="mt-2 py-2">
                  <AlertTitle>Abertura bloqueada pelo contrato</AlertTitle>
                  <AlertDescription className="text-xs">
                    Cliente não possui contrato ativo com atendimento Remoto, Laboratório ou Visita.
                    Cadastre ou ative contrato antes de abrir ticket.
                  </AlertDescription>
                </Alert>
              )}
              {selectedContract?.description && (
                <div className="mt-2 rounded-md border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
                  <div className="font-medium mb-1">Descrição do contrato</div>
                  {selectedContract.description}
                </div>
              )}
            </div>
            <div>
              <Label>Contato</Label>
              <Select
                value={form.contact_id || NONE}
                onValueChange={(v) => setForm({ ...form, contact_id: v === NONE ? "" : v })}
                disabled={!form.company_id}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={form.company_id ? "Selecione…" : "Selecione o cliente antes"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {contacts?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Canal</Label>
              <Select
                value={form.channel}
                onValueChange={(v) => setForm({ ...form, channel: v as TicketChannel })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="chat">Chat</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="portal">Portal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prioridade</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => setForm({ ...form, priority: v as TicketPriority })}
              >
                <SelectTrigger>
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
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as TicketStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Novo</SelectItem>
                  <SelectItem value="in_progress">Em atendimento</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Resolvido/Fechado exigem laudo final - finalize pelo ticket depois de criado.
              </p>
            </div>
            <div>
              <Label>Departamento</Label>
              <Select
                value={form.department_id || NONE}
                onValueChange={(v) => setForm({ ...form, department_id: v === NONE ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {departments?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Responsável</Label>
              <Select
                value={form.assigned_to || NONE}
                onValueChange={(v) => setForm({ ...form, assigned_to: v === NONE ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Não atribuído" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Não atribuído</SelectItem>
                  {agents?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3">
              <Label>Equipamentos</Label>
              {!form.company_id ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Selecione o cliente para listar equipamentos.
                </p>
              ) : !equipments?.length ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Nenhum equipamento cadastrado para este cliente.
                </p>
              ) : (
                <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
                  {equipments.map((eq) => {
                    const checked = form.equipment_ids.includes(eq.id);
                    return (
                      <label
                        key={eq.id}
                        className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setForm({
                              ...form,
                              equipment_ids: e.target.checked
                                ? [...form.equipment_ids, eq.id]
                                : form.equipment_ids.filter((id) => id !== eq.id),
                            });
                          }}
                        />
                        <span>{eq.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {form.equipment_ids.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {form.equipment_ids.length} selecionado(s)
                </p>
              )}
            </div>
            <div className="col-span-3">
              <Label>Descrição inicial</Label>
              <Textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Descreva o problema ou solicitação…"
              />
            </div>
            <DialogFooter className="col-span-3">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  save.isPending ||
                  companiesLoading ||
                  contractsLoading ||
                  contractsError ||
                  (!!form.company_id && !contracts?.length)
                }
              >
                {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {save.isPending ? "Criando ticket…" : "Criar ticket"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={eqPicker.open} onOpenChange={(o) => setEqPicker((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Selecionar equipamentos do contato</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Este contato possui múltiplos equipamentos vinculados. Selecione quais devem ser
            associados ao ticket.
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
                setForm((f) => ({
                  ...f,
                  equipment_ids: Array.from(new Set([...f.equipment_ids, ...eqPicker.selected])),
                }));
                setEqPicker({ open: false, items: [], selected: [] });
              }}
            >
              Associar selecionados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
