// Bloco 2 — hook genérico pra gate de UI por permissão (módulo×ação),
// substitui o antigo `isAdmin` local de settings.tsx. Cacheado via
// react-query (mesmo padrão de outras queries do app).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyPermissions } from "@/lib/permissions.functions";
import { useAuth } from "@/lib/auth";

export function usePermissions() {
  const { user } = useAuth();
  const fn = useServerFn(getMyPermissions);
  const { data, isLoading } = useQuery({
    queryKey: ["my_permissions", user?.id],
    queryFn: () => fn(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const set = useMemo(() => new Set((data ?? []).map((p) => `${p.module}:${p.action}`)), [data]);

  return {
    permissions: data ?? [],
    loading: isLoading,
    has: (module: string, action: string) => set.has(`${module}:${action}`),
  };
}
