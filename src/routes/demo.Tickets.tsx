import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChannelIcon, type TicketChannel } from "@/components/ticket/ChannelIcon";
import { PriorityBadge, type TicketPriority } from "@/components/ticket/PriorityBadge";
import { TicketBadge, type TicketStatus } from "@/components/ticket/TicketBadge";
import { SlaTimer, slaBorderClass, slaState } from "@/components/ticket/SlaTimer";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import { cn } from "@/lib/utils";
import { demoTickets } from "@/lib/demo-seed";

export const Route = createFileRoute("/demo/Tickets")({
  head: () => ({ meta: [{ title: "Tickets — Demo APTicket" }, { name: "robots", content: "noindex" }] }),
  component: DemoTicketsLayout,
});

function DemoTicketsLayout() {
  const matchRoute = useMatchRoute();
  const isDetail = matchRoute({ to: "/demo/Tickets/$id" });
  if (isDetail) return <Outlet />;
  return <DemoTickets />;
}

const SLA_DEFAULT_MIN = 240;

type Row = {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  companyName: string;
  assigneeName: string;
  created_at: string;
  sla_due: string;
};

// Normaliza seed (open -> new, phone -> chat) para casar com os tipos do sistema real
const rows: Row[] = demoTickets.map((t) => ({
  id: t.id,
  number: t.number,
  subject: t.subject,
  status: (t.status === "open" ? "new" : t.status) as TicketStatus,
  priority: t.priority as TicketPriority,
  channel: (t.channel === "phone" ? "chat" : t.channel) as TicketChannel,
  companyName: t.companyName,
  assigneeName: t.assigneeName,
  created_at: t.created_at,
  sla_due: t.sla_due,
}));

const statusColumns: { key: TicketStatus; label: string }[] = [
  { key: "new", label: "Novo" },
  { key: "in_progress", label: "Em Atendimento" },
  { key: "pending", label: "Pendente" },
  { key: "resolved", label: "Resolvido" },
];

function DemoTickets() {
  const [view, setView] = useState<"list" | "kanban">("list");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [channel, setChannel] = useState("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () => rows.filter((t) =>
      (status === "all" || t.status === status) &&
      (priority === "all" || t.priority === priority) &&
      (channel === "all" || t.channel === channel) &&
      (!q || `${t.number} ${t.subject} ${t.companyName}`.toLowerCase().includes(q.toLowerCase())),
    ),
    [status, priority, channel, q],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nº, assunto, cliente…" className="h-7 w-56 pl-7 text-xs" />
        </div>
        <FilterSelect value={status} onChange={setStatus} options={[
          { value: "all", label: "Todos status" },
          { value: "new", label: "Novo" },
          { value: "in_progress", label: "Em Atendimento" },
          { value: "pending", label: "Pendente" },
          { value: "resolved", label: "Resolvido" },
          { value: "closed", label: "Fechado" },
        ]} />
        <FilterSelect value={priority} onChange={setPriority} options={[
          { value: "all", label: "Todas prioridades" },
          { value: "low", label: "Baixa" },
          { value: "medium", label: "Média" },
          { value: "high", label: "Alta" },
          { value: "urgent", label: "Urgente" },
        ]} />
        <FilterSelect value={channel} onChange={setChannel} options={[
          { value: "all", label: "Todos canais" },
          { value: "email", label: "E-mail" },
          { value: "whatsapp", label: "WhatsApp" },
          { value: "chat", label: "Chat" },
          { value: "portal", label: "Portal" },
        ]} />

        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-md border p-0.5">
            <button onClick={() => setView("list")} className={cn("flex h-6 items-center gap-1 rounded-sm px-2 text-xs", view === "list" && "bg-accent")}>
              <List className="h-3 w-3" /> Lista
            </button>
            <button onClick={() => setView("kanban")} className={cn("flex h-6 items-center gap-1 rounded-sm px-2 text-xs", view === "kanban" && "bg-accent")}>
              <LayoutGrid className="h-3 w-3" /> Kanban
            </button>
          </div>
          <Button size="sm" className="h-7 gap-1 text-xs" disabled title="Disponível no sistema real">
            <Plus className="h-3.5 w-3.5" /> Novo ticket
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {view === "list" ? <DemoList rows={filtered} /> : <DemoKanban rows={filtered} />}
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto min-w-[140px] gap-1 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function DemoList({ rows }: { rows: Row[] }) {
  if (!rows.length) return <div className="p-12 text-center text-sm text-muted-foreground">Nenhum ticket encontrado.</div>;
  return (
    <div className="p-2">
      <ConfigurableTable<Row>
        listKey="demo-tickets"
        rows={rows}
        rowKey={(t) => t.id}
        rowClassName={(t) => cn("border-l-4", slaBorderClass(slaState(t.sla_due, SLA_DEFAULT_MIN)))}
        defaultColumns={["number", "subject", "company", "assignee", "priority", "sla", "status", "channel"]}
        columns={[
          { key: "number", label: "#", className: "font-mono text-muted-foreground w-16", cell: (t) => `#${t.number}` },
          { key: "subject", label: "Assunto", cell: (t) => <Link to="/demo/Tickets/$id" params={{ id: t.id }} className="font-medium hover:underline">{t.subject}</Link> },
          { key: "company", label: "Empresa", cell: (t) => t.companyName },
          { key: "assignee", label: "Técnico", className: "text-muted-foreground", cell: (t) => t.assigneeName },
          { key: "priority", label: "Prioridade", cell: (t) => <PriorityBadge priority={t.priority} /> },
          { key: "sla", label: "SLA", cell: (t) => <SlaTimer dueAt={t.sla_due} totalMinutes={SLA_DEFAULT_MIN} stoppedAt={null} /> },
          { key: "status", label: "Status", cell: (t) => <TicketBadge status={t.status} /> },
          { key: "channel", label: "Canal", className: "w-10", cell: (t) => <ChannelIcon channel={t.channel} /> },
          { key: "created_at", label: "Criado em", className: "text-xs text-muted-foreground", cell: (t) => new Date(t.created_at).toLocaleString("pt-BR") },
        ] as ListColumn<Row>[]}
      />
    </div>
  );
}

function DemoKanban({ rows }: { rows: Row[] }) {
  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 md:grid-cols-4">
      {statusColumns.map((col) => {
        const items = rows.filter((t) => t.status === col.key);
        return (
          <div key={col.key} className="flex flex-col rounded-md border bg-muted/30">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
              <span>{col.label}</span>
              <span className="rounded bg-background px-1.5 text-[10px] text-muted-foreground">{items.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-2">
              {items.map((t) => {
                const state = slaState(t.sla_due, SLA_DEFAULT_MIN);
                return (
                  <Link key={t.id} to="/demo/Tickets/$id" params={{ id: t.id }} className={cn("block rounded-md border border-l-4 bg-background p-2 text-xs hover:bg-accent", slaBorderClass(state))}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">#{t.number}</span>
                      <ChannelIcon channel={t.channel} />
                    </div>
                    <div className="mt-1 line-clamp-2 font-medium">{t.subject}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{t.companyName}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <PriorityBadge priority={t.priority} />
                      <SlaTimer dueAt={t.sla_due} totalMinutes={SLA_DEFAULT_MIN} className="text-[10px]" stoppedAt={null} />
                    </div>
                  </Link>
                );
              })}
              {!items.length && <p className="py-4 text-center text-[10px] text-muted-foreground">Sem tickets</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
