import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LayoutGrid, List, Plus, Search } from "lucide-react";
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
import { ChannelIcon, type TicketChannel } from "@/components/ticket/ChannelIcon";
import { PriorityBadge, type TicketPriority } from "@/components/ticket/PriorityBadge";
import { TicketBadge, type TicketStatus } from "@/components/ticket/TicketBadge";
import { PendingBadge, type PendingType } from "@/components/ticket/PendingBadge";
import { SlaTimer, slaBorderClass, slaState } from "@/components/ticket/SlaTimer";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import { TicketAutoRefresh } from "@/components/ticket/TicketAutoRefresh";
import { FinalizeTicketDialog, type FinalReport } from "@/components/ticket/FinalizeTicketDialog";
import { useModulePermissions } from "@/lib/permission-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const Route = createFileRoute("/_authenticated/tickets")({
  head: () => ({ meta: [{ title: "Tickets — APTicket" }] }),
  component: TicketsLayout,
});

function TicketsLayout() {
  const matchRoute = useMatchRoute();
  const isDetail = matchRoute({ to: "/tickets/$id" });
  if (isDetail) return <Outlet />;
  return <TicketsInbox />;
}

type TicketRow = {
  id: string;
  tenant_id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  pending_type: PendingType;
  priority: TicketPriority;
  channel: TicketChannel;
  company_id: string | null;
  contact_id: string | null;
  contract_id: string | null;
  department_id: string | null;
  assigned_to: string | null;
  created_at: string;
  sla_resolution_due_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  resolution_summary: string | null;
  companies: { name: string } | null;
  contacts: { name: string } | null;
  assigneeName?: string;
};

const SLA_DEFAULT_MIN = 240;

const statusColumns: { key: TicketStatus; label: string }[] = [
  { key: "new", label: "Novo" },
  { key: "in_progress", label: "Em Atendimento" },
  { key: "pending", label: "Pendente" },
  { key: "resolved", label: "Resolvido" },
];

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "new", label: "Novo" },
  { value: "in_progress", label: "Em atendimento" },
  { value: "pending", label: "Pendente" },
  { value: "resolved", label: "Resolvido" },
  { value: "closed", label: "Fechado" },
];

const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

const CHANNEL_OPTIONS: { value: TicketChannel; label: string }[] = [
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "chat", label: "Chat" },
  { value: "manual", label: "Manual" },
  { value: "portal", label: "Portal" },
];

function TicketsInbox() {
  const access = useModulePermissions("tickets");
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "kanban">("list");
  const [status, setStatus] = useState<TicketStatus[]>(["new", "in_progress", "pending"]);
  const [priority, setPriority] = useState<TicketPriority[]>([]);
  const [assignee, setAssignee] = useState<string[]>([]);
  const [channel, setChannel] = useState<TicketChannel[]>([]);
  const [department, setDepartment] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const filterRef = useRef<HTMLButtonElement>(null);

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

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("*, companies(name), contacts(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = Array.from(
        new Set((data ?? []).map((t) => t.assigned_to).filter(Boolean)),
      ) as string[];
      let nameById: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, name").in("id", ids);
        nameById = Object.fromEntries((profs ?? []).map((p) => [p.id, p.name]));
      }
      return (data ?? []).map((t) => ({
        ...t,
        assigneeName: t.assigned_to ? nameById[t.assigned_to] : undefined,
      })) as unknown as TicketRow[];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments", "options"],
    queryFn: async () =>
      (await supabase.from("departments").select("id, name").order("name")).data ?? [],
  });
  const { data: agents = [] } = useQuery({
    queryKey: ["agents", "options"],
    queryFn: async () =>
      (await supabase.from("profiles").select("id, name").order("name")).data ?? [],
  });

  const filtered = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (status.length === 0 || status.includes(t.status)) &&
          (priority.length === 0 || priority.includes(t.priority)) &&
          (assignee.length === 0 || (t.assigned_to !== null && assignee.includes(t.assigned_to))) &&
          (channel.length === 0 || channel.includes(t.channel)) &&
          (department.length === 0 ||
            (t.department_id !== null && department.includes(t.department_id))) &&
          (!q ||
            `${t.number} ${t.subject} ${t.companies?.name ?? ""}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [tickets, status, priority, assignee, channel, department, q],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <TicketAutoRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ["tickets"] })} />
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nº, assunto, cliente…"
            className="h-7 w-56 pl-7 text-xs"
          />
        </div>
        <MultiFilter
          triggerRef={filterRef}
          label="Departamento"
          values={department}
          onChange={setDepartment}
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
        />
        <MultiFilter label="Status" values={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <MultiFilter
          label="Prioridade"
          values={priority}
          onChange={setPriority}
          options={PRIORITY_OPTIONS}
        />
        <MultiFilter
          label="Técnico"
          values={assignee}
          onChange={setAssignee}
          options={agents.map((a) => ({ value: a.id, label: a.name }))}
        />
        <MultiFilter
          label="Canal"
          values={channel}
          onChange={setChannel}
          options={CHANNEL_OPTIONS}
        />

        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-md border p-0.5">
            <button
              onClick={() => setView("list")}
              className={cn(
                "flex h-6 items-center gap-1 rounded-sm px-2 text-xs",
                view === "list" && "bg-accent",
              )}
            >
              <List className="h-3 w-3" /> Lista
            </button>
            <button
              onClick={() => setView("kanban")}
              className={cn(
                "flex h-6 items-center gap-1 rounded-sm px-2 text-xs",
                view === "kanban" && "bg-accent",
              )}
            >
              <LayoutGrid className="h-3 w-3" /> Kanban
            </button>
          </div>
          {access.create && (
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setOpenNew(true)}>
              <Plus className="h-3.5 w-3.5" /> Novo ticket
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : view === "list" ? (
          <TicketList tickets={filtered} />
        ) : (
          <TicketKanban tickets={filtered} />
        )}
      </div>
      <div className="border-t bg-muted/40 px-3 py-1 text-[10px] text-muted-foreground">
        Atalhos:{" "}
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

function MultiFilter<T extends string>({
  label,
  values,
  onChange,
  options,
  triggerRef,
}: {
  label: string;
  values: T[];
  onChange: (values: T[]) => void;
  options: { value: T; label: string }[];
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const toggle = (value: T) => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };
  const summary = values.length === 0 ? `${label}: todos` : `${label}: ${values.length}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="h-7 min-w-[140px] justify-between gap-2 px-2 text-xs font-normal"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="flex items-center justify-between border-b px-2 py-1.5 text-xs">
          <span className="text-muted-foreground">
            {values.length === 0 ? "Todos" : `${values.length} selecionado(s)`}
          </span>
          {values.length > 0 ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onChange([])}
            >
              Limpar
            </button>
          ) : (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onChange(options.map((option) => option.value))}
            >
              Todos
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={values.includes(option.value)}
                onCheckedChange={() => toggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function dueFor(t: TicketRow) {
  return (
    t.sla_resolution_due_at ??
    new Date(new Date(t.created_at).getTime() + SLA_DEFAULT_MIN * 60_000).toISOString()
  );
}

function TicketList({ tickets }: { tickets: TicketRow[] }) {
  if (!tickets.length)
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        Nenhum ticket encontrado.
      </div>
    );
  return (
    <div className="p-2">
      <ConfigurableTable<TicketRow>
        listKey="tickets"
        rows={tickets}
        rowKey={(t) => t.id}
        rowClassName={(t) => cn("border-l-4", slaBorderClass(slaState(dueFor(t), SLA_DEFAULT_MIN)))}
        defaultColumns={[
          "number",
          "subject",
          "customer",
          "assignee",
          "priority",
          "sla",
          "status",
          "channel",
        ]}
        columns={
          [
            {
              key: "number",
              label: "#",
              className: "font-mono text-muted-foreground w-16",
              cell: (t) => `#${t.number}`,
            },
            {
              key: "subject",
              label: "Assunto",
              cell: (t) => (
                <Link
                  to="/tickets/$id"
                  params={{ id: t.id }}
                  className="font-medium hover:underline"
                >
                  {t.subject}
                </Link>
              ),
            },
            {
              key: "customer",
              label: "Cliente",
              cell: (t) => (
                <div className="flex flex-col">
                  <span>{t.contacts?.name ?? "—"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t.companies?.name ?? "—"}
                  </span>
                </div>
              ),
            },
            { key: "company", label: "Empresa", cell: (t) => t.companies?.name ?? "—" },
            { key: "contact", label: "Contato", cell: (t) => t.contacts?.name ?? "—" },
            {
              key: "assignee",
              label: "Técnico",
              className: "text-muted-foreground",
              cell: (t) => t.assigneeName ?? "—",
            },
            {
              key: "priority",
              label: "Prioridade",
              cell: (t) => <PriorityBadge priority={t.priority} />,
            },
            {
              key: "sla",
              label: "SLA",
              cell: (t) => (
                <SlaTimer
                  dueAt={dueFor(t)}
                  totalMinutes={SLA_DEFAULT_MIN}
                  stoppedAt={t.resolved_at ?? t.closed_at ?? null}
                />
              ),
            },
            {
              key: "status",
              label: "Status",
              cell: (t) => (
                <div className="flex flex-col items-start gap-1">
                  <TicketBadge status={t.status} />
                  <PendingBadge pending={t.pending_type} />
                </div>
              ),
            },
            {
              key: "channel",
              label: "Canal",
              className: "w-10",
              cell: (t) => <ChannelIcon channel={t.channel} />,
            },
            {
              key: "created_at",
              label: "Criado em",
              className: "text-xs text-muted-foreground",
              cell: (t) => new Date(t.created_at).toLocaleString("pt-BR"),
            },
          ] as ListColumn<TicketRow>[]
        }
      />
    </div>
  );
}

function TicketKanban({ tickets }: { tickets: TicketRow[] }) {
  const access = useModulePermissions("tickets");
  const qc = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TicketStatus | null>(null);
  const [finalizeTarget, setFinalizeTarget] = useState<{
    id: string;
    status: "resolved" | "closed";
  } | null>(null);

  const move = useMutation({
    mutationFn: async ({
      id,
      status,
      services,
      ...report
    }: { id: string; status: TicketStatus } & Partial<FinalReport>) => {
      if (!access.edit) throw new Error("Sem permissão para editar chamados");
      const { error } = await supabase
        .from("tickets")
        .update({ status, ...report })
        .eq("id", id);
      if (error) throw error;

      if (services?.length) {
        const t = tickets.find((x) => x.id === id);
        if (!t) return;
        const authorId = getCurrentUserId();
        const rows = services.map((s) => ({
          tenant_id: t.tenant_id,
          ticket_id: id,
          provided_service_id: s.provided_service_id,
          complement: s.complement || null,
          created_by: authorId,
        }));
        const { error: svcErr } = await supabase.from("ticket_services_performed").insert(rows);
        if (svcErr) throw svcErr;
      }
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tickets"] });
      const prev = qc.getQueryData<TicketRow[]>(["tickets"]);
      qc.setQueryData<TicketRow[]>(["tickets"], (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, status } : t)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tickets"], ctx.prev);
      toast.error("Não foi possível mover o ticket");
    },
    onSuccess: () => {
      toast.success("Status atualizado");
      setFinalizeTarget(null);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });

  // Resolver exige laudo final — a menos que o ticket já tenha um.
  const requestMove = (id: string, status: TicketStatus) => {
    if (!access.edit) return;
    const t = tickets.find((x) => x.id === id);
    if (!t || t.status === status) return;
    if (status === "resolved" && !t.resolution_summary?.trim()) {
      setFinalizeTarget({ id, status });
    } else {
      move.mutate({ id, status });
    }
  };

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 md:grid-cols-4">
      {statusColumns.map((col) => {
        const items = tickets.filter((t) => t.status === col.key);
        const isOver = overCol === col.key;
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              if (!access.edit) return;
              e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              if (!access.edit) return;
              e.preventDefault();
              const id = e.dataTransfer.getData("text/ticket-id") || dragId;
              setOverCol(null);
              setDragId(null);
              if (id) requestMove(id, col.key);
            }}
            className={cn(
              "flex flex-col rounded-md border bg-muted/30 transition-colors",
              isOver && "border-primary bg-primary/5",
            )}
          >
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
              <span>{col.label}</span>
              <span className="rounded bg-background px-1.5 text-[10px] text-muted-foreground">
                {items.length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-2">
              {items.map((t) => {
                const due = dueFor(t);
                const state = slaState(due, SLA_DEFAULT_MIN);
                return (
                  <Link
                    key={t.id}
                    to="/tickets/$id"
                    params={{ id: t.id }}
                    draggable={access.edit}
                    onDragStart={(e) => {
                      if (!access.edit) return;
                      setDragId(t.id);
                      e.dataTransfer.setData("text/ticket-id", t.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    className={cn(
                      "block rounded-md border border-l-4 bg-background p-2 text-xs hover:bg-accent",
                      access.edit && "cursor-grab active:cursor-grabbing",
                      slaBorderClass(state),
                      dragId === t.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #{t.number}
                      </span>
                      <ChannelIcon channel={t.channel} />
                    </div>
                    <div className="mt-1 line-clamp-2 font-medium">{t.subject}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {t.companies?.name ?? "—"}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <PriorityBadge priority={t.priority} />
                      <SlaTimer
                        dueAt={due}
                        totalMinutes={SLA_DEFAULT_MIN}
                        className="text-[10px]"
                        stoppedAt={t.resolved_at ?? t.closed_at ?? null}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
      {finalizeTarget && access.edit && (
        <FinalizeTicketDialog
          status={finalizeTarget.status}
          ticketSubject={tickets.find((t) => t.id === finalizeTarget.id)?.subject ?? ""}
          submitting={move.isPending}
          onCancel={() => setFinalizeTarget(null)}
          onConfirm={(report) =>
            move.mutate({ id: finalizeTarget.id, status: finalizeTarget.status, ...report })
          }
        />
      )}
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
  contract_id: z.string().uuid("Cliente sem contrato ativo — cadastre um contrato antes."),
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

  const { data: companies } = useQuery({
    queryKey: ["companies", "options"],
    queryFn: async () =>
      (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", "options", form.company_id],
    enabled: !!form.company_id,
    queryFn: async () =>
      (
        await supabase
          .from("contacts")
          .select("id, name")
          .eq("company_id", form.company_id)
          .order("name")
      ).data ?? [],
  });
  const { data: contracts } = useQuery({
    queryKey: ["contracts", "active", form.company_id],
    enabled: !!form.company_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("contracts")
        .select(
          "id, status, starts_at, ends_at, description, includes_remote, includes_lab, includes_onsite, contract_equipments(equipment_id), contract_types(name)",
        )
        .eq("company_id", form.company_id)
        .eq("status", "active")
        .order("starts_at", { ascending: false });
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
              <Label>Assunto *</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </div>
            <div>
              <Label>Cliente *</Label>
              <Select
                value={form.company_id}
                onValueChange={(v) =>
                  setForm({ ...form, company_id: v, contact_id: "", contract_id: "" })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
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
              <Label>Contrato ativo *</Label>
              <Select
                value={form.contract_id}
                onValueChange={(v) => setForm({ ...form, contract_id: v })}
                disabled={!form.company_id}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !form.company_id
                        ? "Selecione o cliente antes"
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
                      {c.description ? ` — ${c.description.slice(0, 60)}` : ""} ({c.starts_at} →{" "}
                      {c.ends_at})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.company_id && !contracts?.length && (
                <p className="text-xs text-destructive mt-1">
                  Nenhum contrato ativo com suporte técnico (Remoto/Laboratório/Visita) para este
                  cliente.
                </p>
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
                Resolvido/Fechado exigem laudo final — finalize pelo ticket depois de criado.
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
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Salvando…" : "Salvar"}
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
