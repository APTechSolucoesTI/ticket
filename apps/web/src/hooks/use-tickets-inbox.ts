import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  ticketInboxResultSchema,
  ticketMetricsSchema,
  type TicketListQuery,
} from "@/lib/ticket-query";

export function useTicketMetrics(periodDays: 7 | 14 | 30, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tickets", "metrics", user?.tenantId, user?.id, periodDays],
    enabled: !!user && enabled,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc("get_ticket_metrics", { _period_days: periodDays })
        .abortSignal(signal);
      if (error) throw error;
      return ticketMetricsSchema.parse(data);
    },
    placeholderData: keepPreviousData,
  });
}

export function useTicketsInboxData({
  canViewEmailQueue,
  canViewWhatsappQueue,
  query,
}: {
  canViewEmailQueue: boolean;
  canViewWhatsappQueue: boolean;
  query: TicketListQuery;
}) {
  const { user } = useAuth();
  const { status, attendanceType, priority, channel, assignee, department } = query;
  const filters = { status, attendanceType, priority, channel, assignee, department };
  const ticketsQuery = useQuery({
    queryKey: [
      "tickets",
      "inbox",
      user?.tenantId,
      user?.id,
      query.page,
      query.pageSize,
      query.search,
      filters,
      query.sortKey,
      query.sortDirection,
    ],
    enabled: !!user,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc("list_ticket_inbox", {
          _page: query.page,
          _page_size: query.pageSize,
          _search: query.search,
          _filters: filters,
          _sort_key: query.sortKey || "created_at",
          _sort_direction: query.sortKey ? query.sortDirection : "desc",
        })
        .abortSignal(signal);
      if (error) throw error;
      return ticketInboxResultSchema.parse(data);
    },
  });

  const departmentsQuery = useQuery({
    queryKey: ["departments", "options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const agentsQuery = useQuery({
    queryKey: ["agents", "options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const queueSummaryQuery = useQuery({
    queryKey: ["ticket-queue-summary", canViewEmailQueue, canViewWhatsappQueue],
    enabled: canViewEmailQueue || canViewWhatsappQueue,
    queryFn: async () => {
      const [emailResult, whatsappResult] = await Promise.all([
        canViewEmailQueue
          ? supabase.from("email_pending_messages").select("id").is("resolved_at", null).limit(1)
          : Promise.resolve({ data: [], error: null }),
        canViewWhatsappQueue
          ? supabase.from("whatsapp_pending_messages").select("id").is("resolved_at", null).limit(1)
          : Promise.resolve({ data: [], error: null }),
      ]);

      return {
        email: {
          hasPending: (emailResult.data?.length ?? 0) > 0,
          error: Boolean(emailResult.error),
        },
        whatsapp: {
          hasPending: (whatsappResult.data?.length ?? 0) > 0,
          error: Boolean(whatsappResult.error),
        },
      };
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always" as const,
  });

  return {
    ticketsQuery,
    departmentsQuery,
    agentsQuery,
    queueSummaryQuery,
  };
}
