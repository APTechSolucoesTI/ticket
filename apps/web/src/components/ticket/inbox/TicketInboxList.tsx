import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { ChannelIcon } from "@/components/ticket/ChannelIcon";
import { PendingBadge } from "@/components/ticket/PendingBadge";
import { PriorityBadge } from "@/components/ticket/PriorityBadge";
import { SlaTimer, slaBorderClass, slaState } from "@/components/ticket/SlaTimer";
import { TicketBadge } from "@/components/ticket/TicketBadge";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SLA_DEFAULT_MIN, dueFor, type TicketRow } from "@/lib/ticket-inbox";
import { cn } from "@/lib/utils";

const columns: ListColumn<TicketRow>[] = [
  {
    key: "number",
    label: "#",
    className: "font-mono text-muted-foreground w-16",
    cell: (ticket) => `#${ticket.number}`,
  },
  {
    key: "subject",
    label: "Assunto",
    cell: (ticket) => (
      <Link to="/tickets/$id" params={{ id: ticket.id }} className="font-medium hover:underline">
        {ticket.subject}
      </Link>
    ),
  },
  {
    key: "customer",
    label: "Cliente",
    cell: (ticket) => (
      <div className="flex flex-col">
        <span>{ticket.contacts?.name ?? "—"}</span>
        <span className="text-[10px] text-muted-foreground">{ticket.companies?.name ?? "—"}</span>
      </div>
    ),
  },
  { key: "company", label: "Empresa", cell: (ticket) => ticket.companies?.name ?? "—" },
  { key: "contact", label: "Contato", cell: (ticket) => ticket.contacts?.name ?? "—" },
  {
    key: "assignee",
    label: "Técnico",
    className: "text-muted-foreground",
    cell: (ticket) => ticket.assigneeName ?? "—",
  },
  {
    key: "priority",
    label: "Prioridade",
    cell: (ticket) => <PriorityBadge priority={ticket.priority} />,
  },
  {
    key: "sla",
    label: "SLA",
    cell: (ticket) => (
      <SlaTimer
        dueAt={dueFor(ticket)}
        totalMinutes={SLA_DEFAULT_MIN}
        stoppedAt={ticket.sla_paused_at ?? ticket.resolved_at ?? ticket.closed_at ?? null}
      />
    ),
  },
  {
    key: "status",
    label: "Status",
    cell: (ticket) => (
      <div className="flex flex-col items-start gap-1">
        <TicketBadge status={ticket.status} />
        <PendingBadge pending={ticket.pending_type} />
      </div>
    ),
  },
  {
    key: "channel",
    label: "Canal",
    className: "w-10",
    cell: (ticket) => <ChannelIcon channel={ticket.channel} />,
  },
  {
    key: "created_at",
    label: "Criado em",
    className: "text-xs text-muted-foreground",
    cell: (ticket) => new Date(ticket.created_at).toLocaleString("pt-BR"),
  },
];

export const TicketInboxList = memo(function TicketInboxList({
  tickets,
}: {
  tickets: TicketRow[];
}) {
  return (
    <div className="p-2">
      <ConfigurableTable<TicketRow>
        listKey="tickets"
        rows={tickets}
        rowKey={(ticket) => ticket.id}
        rowClassName={(ticket) =>
          cn("border-l-4", slaBorderClass(slaState(dueFor(ticket), SLA_DEFAULT_MIN)))
        }
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
        columns={columns}
      />
    </div>
  );
});

export function TicketPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Paginação dos tickets"
      className="flex flex-wrap items-center justify-between gap-2 border-t bg-background px-3 py-2 text-xs"
    >
      <span className="text-muted-foreground" aria-live="polite">
        Mostrando {start}–{end} de {total}
      </span>
      <div className="flex items-center gap-2">
        <LabelledPageSize value={pageSize} onChange={onPageSizeChange} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </Button>
        <span className="min-w-20 text-center">
          Página {page} de {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </nav>
  );
}

function LabelledPageSize({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="whitespace-nowrap text-muted-foreground">Por página</span>
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger className="h-7 w-16 text-xs" aria-label="Tickets por página">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[25, 50, 100].map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
