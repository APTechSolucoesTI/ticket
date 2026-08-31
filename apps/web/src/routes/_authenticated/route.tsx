import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/use-permissions";
import { moduleForRoute } from "@/lib/permission-catalog";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { EmptyStub } from "@/components/empty-stub";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const perms = usePermissions();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  // Verificação de permissão vigente a cada navegação (não só sidebar
  // escondida - bloqueia acesso direto por URL também). Reavalia sempre que
  // a rota muda, então pega alteração de permissão feita em outra sessão
  // assim que o usuário navegar de novo (troca de aba/menu já revalida).
  if (perms.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }
  const requiredModule = moduleForRoute(pathname);
  if (requiredModule && !perms.has(requiredModule, "view")) {
    return (
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main className="flex-1 overflow-y-auto p-6">
            <EmptyStub title="Sem acesso" message="Você não tem permissão pra ver esta página." />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppHeader />
        <main className="flex-1 overflow-y-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
