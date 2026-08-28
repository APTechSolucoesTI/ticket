import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TicketRow } from "@/lib/ticket-inbox";

export function useTicketsInboxData({
  canViewEmailQueue,
  canViewWhatsappQueue,
}: {
  canViewEmailQueue: boolean;
  canViewWhatsappQueue: boolean;
}) {
  const ticketsQuery = useQuery({
    queryKey: ["tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select(
          "id, tenant_id, number, subject, status, pending_type, priority, channel, company_id, contact_id, contract_id, department_id, assigned_to, created_at, sla_resolution_due_at, sla_paused_at, resolved_at, closed_at, resolution_summary, companies(name), contacts(name)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = Array.from(
        new Set((data ?? []).map((ticket) => ticket.assigned_to).filter(Boolean)),
      ) as string[];
      let nameById: Record<string, string> = {};
      if (ids.length) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", ids);
        if (profilesError) throw profilesError;
        nameById = Object.fromEntries(
          (profiles ?? []).map((profile) => [profile.id, profile.name]),
        );
      }

      return (data ?? []).map((ticket) => ({
        ...ticket,
        assigneeName: ticket.assigned_to ? nameById[ticket.assigned_to] : undefined,
      })) as unknown as TicketRow[];
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
