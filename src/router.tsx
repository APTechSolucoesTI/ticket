import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Dados ficam frescos por 1 min — evita refetch ao trocar de aba/rota.
        staleTime: 60_000,
        // Mantém cache por 5 min após o último observer desmontar.
        gcTime: 5 * 60_000,
        // Sem refetch agressivo ao focar a janela (UX SaaS típico).
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always",
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Query controla a freshness; o router não deve servir cache de preload.
    defaultPreloadStaleTime: 0,
  });

  return router;
};

