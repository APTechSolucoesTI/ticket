import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChannelIcon } from "@/components/ticket/ChannelIcon";
import { FinalizeTicketDialog, type FinalReport } from "@/components/ticket/FinalizeTicketDialog";
import { PriorityBadge } from "@/components/ticket/PriorityBadge";
import { AttendanceBadge } from "@/components/ticket/AttendanceBadge";
import { SlaTimer, slaBorderClass, slaState } from "@/components/ticket/SlaTimer";
import type { TicketStatus } from "@/components/ticket/TicketBadge";
import { supabase } from "@/integrations/supabase/client";
import { useModulePermissions } from "@/lib/permission-ui";
import { getCurrentUserId } from "@/lib/session";
import { SLA_DEFAULT_MIN, dueFor, type TicketRow } from "@/lib/ticket-inbox";
import { cn } from "@/lib/utils";

const statusColumns: { key: TicketStatus; label: string }[] = [
  { key: "new", label: "Novo" },
  { key: "in_progress", label: "Em Atendimento" },
  { key: "pending", label: "Pendente" },
  { key: "resolved", label: "Resolvido" },
];

export function TicketInboxKanban({ tickets }: { tickets: TicketRow[] }) {
  const access = useModulePermissions("tickets");
  const queryClient = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TicketStatus | null>(null);
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
        const ticket = tickets.find((item) => item.id === id);
        if (!ticket) return;
        const rows = services.map((service) => ({
          tenant_id: ticket.tenant_id,
          ticket_id: id,
          provided_service_id: service.provided_service_id,
          complement: service.complement || null,
          created_by: getCurrentUserId(),
        }));
        const { error: serviceError } = await supabase
          .from("ticket_services_performed")
          .insert(rows);
        if (serviceError) throw serviceError;
      }
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["tickets"] });
      const previous = queryClient.getQueryData<TicketRow[]>(["tickets"]);
      queryClient.setQueryData<TicketRow[]>(["tickets"], (current) =>
        (current ?? []).map((ticket) => (ticket.id === id ? { ...ticket, status } : ticket)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["tickets"], context.previous);
      toast.error("Não foi possível mover o ticket");
    },
    onSuccess: () => {
      toast.success("Status atualizado");
      setFinalizeTarget(null);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  });

  const requestMove = (id: string, status: TicketStatus) => {
    if (!access.edit) return;
    const ticket = tickets.find((item) => item.id === id);
    if (!ticket || ticket.status === status) return;
    if (status === "resolved" && !ticket.resolution_summary?.trim()) {
      setFinalizeTarget({ id, status });
    } else {
      move.mutate({ id, status });
    }
  };

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 md:grid-cols-4">
      {statusColumns.map((column) => {
        const items = tickets.filter((ticket) => ticket.status === column.key);
        return (
          <section
            key={column.key}
            onDragOver={(event) => {
              if (!access.edit) return;
              event.preventDefault();
              setOverColumn(column.key);
            }}
            onDragLeave={() =>
              setOverColumn((current) => (current === column.key ? null : current))
            }
            onDrop={(event) => {
              if (!access.edit) return;
              event.preventDefault();
              const id = event.dataTransfer.getData("text/ticket-id") || dragId;
              setOverColumn(null);
              setDragId(null);
              if (id) requestMove(id, column.key);
            }}
            className={cn(
              "flex flex-col rounded-md border bg-muted/30 transition-colors",
              overColumn === column.key && "border-primary bg-primary/5",
            )}
          >
            <header className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
              <span>{column.label}</span>
              <span className="rounded bg-background px-1.5 text-[10px] text-muted-foreground">
                {items.length}
              </span>
            </header>
            <div className="flex-1 space-y-2 overflow-auto p-2">
              {items.length === 0 && (
                <p className="rounded-md border border-dashed bg-background/60 px-3 py-6 text-center text-[11px] text-muted-foreground">
                  Nenhum ticket nesta etapa.
                </p>
              )}
              {items.map((ticket) => {
                const due = dueFor(ticket);
                return (
                  <Link
                    key={ticket.id}
                    to="/tickets/$id"
                    params={{ id: ticket.id }}
                    draggable={access.edit}
                    onDragStart={(event) => {
                      if (!access.edit) return;
                      setDragId(ticket.id);
                      event.dataTransfer.setData("text/ticket-id", ticket.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverColumn(null);
                    }}
                    className={cn(
                      "block rounded-md border border-l-4 bg-background p-2 text-xs hover:bg-accent",
                      access.edit && "cursor-grab active:cursor-grabbing",
                      ticket.tipo_atendimento === "avulso"
                        ? "border-l-amber-500"
                        : slaBorderClass(slaState(due, SLA_DEFAULT_MIN)),
                      dragId === ticket.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #{ticket.number}
                      </span>
                      <ChannelIcon channel={ticket.channel} />
                    </div>
                    <div className="mt-1 line-clamp-2 font-medium">{ticket.subject}</div>
                    <div className="mt-1">
                      <AttendanceBadge type={ticket.tipo_atendimento} />
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {ticket.companies?.name ?? "-"}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <PriorityBadge priority={ticket.priority} />
                      {ticket.tipo_atendimento === "avulso" ? (
                        <span className="text-[10px] text-muted-foreground">Sem SLA</span>
                      ) : (
                        <SlaTimer
                          dueAt={due}
                          totalMinutes={SLA_DEFAULT_MIN}
                          className="text-[10px]"
                          stoppedAt={ticket.sla_paused_at ?? ticket.resolved_at ?? ticket.closed_at}
                        />
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
      {finalizeTarget && access.edit && (
        <FinalizeTicketDialog
          status={finalizeTarget.status}
          ticketSubject={tickets.find((ticket) => ticket.id === finalizeTarget.id)?.subject ?? ""}
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
