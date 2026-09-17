import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { ChannelIcon } from "@/components/ticket/ChannelIcon";
import { PendingBadge } from "@/components/ticket/PendingBadge";
import { PriorityBadge } from "@/components/ticket/PriorityBadge";
import { SlaTimer, slaBorderClass, slaState } from "@/components/ticket/SlaTimer";
import { TicketBadge } from "@/components/ticket/TicketBadge";
import { AttendanceBadge } from "@/components/ticket/AttendanceBadge";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
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
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/tickets/$id" params={{ id: ticket.id }} className="font-medium hover:underline">
          {ticket.subject}
        </Link>
        <AttendanceBadge type={ticket.tipo_atendimento} />
      </div>
    ),
  },
  {
    key: "customer",
    label: "Cliente",
    accessor: (ticket) => `${ticket.contacts?.name ?? ""} ${ticket.companies?.name ?? ""}`,
    cell: (ticket) => (
      <div className="flex flex-col">
        <span>{ticket.contacts?.name ?? "-"}</span>
        <span className="text-[10px] text-muted-foreground">{ticket.companies?.name ?? "-"}</span>
      </div>
    ),
  },
  {
    key: "company",
    label: "Empresa",
    accessor: (ticket) => ticket.companies?.name ?? "",
    cell: (ticket) => ticket.companies?.name ?? "-",
  },
  {
    key: "contact",
    label: "Contato",
    accessor: (ticket) => ticket.contacts?.name ?? "",
    cell: (ticket) => ticket.contacts?.name ?? "-",
  },
  {
    key: "assignee",
    label: "Técnico",
    className: "text-muted-foreground",
    accessor: (ticket) => ticket.assigneeName ?? "",
    cell: (ticket) => ticket.assigneeName ?? "-",
  },
  {
    key: "priority",
    label: "Prioridade",
    cell: (ticket) => <PriorityBadge priority={ticket.priority} />,
  },
  {
    key: "sla",
    label: "SLA",
    accessor: (ticket) => dueFor(ticket) ?? "",
    cell: (ticket) =>
      ticket.tipo_atendimento === "avulso" ? (
        <span className="text-xs text-muted-foreground">Sem SLA contratual</span>
      ) : (
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
    accessor: (ticket) => `${ticket.status} ${ticket.pending_type ?? ""}`,
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
    accessor: (ticket) => ticket.channel,
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
          cn(
            "border-l-4",
            ticket.tipo_atendimento === "avulso"
              ? "border-l-amber-500"
              : slaBorderClass(slaState(dueFor(ticket), SLA_DEFAULT_MIN)),
          )
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
