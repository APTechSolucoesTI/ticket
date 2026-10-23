import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Settings } from "lucide-react";
import { EmptyStub, PageHeader } from "@/components/empty-stub";
import { usePermissions } from "@/lib/use-permissions";
import {
  SETTINGS_SECTIONS,
  settingsSectionForPath,
  settingsTrail,
} from "@/lib/settings-navigation";

export function SettingsLayout() {
  const permissions = usePermissions();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const key = settingsSectionForPath(pathname);
  const section = key ? SETTINGS_SECTIONS[key] : undefined;
  if (permissions.loading)
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!permissions.has("configuracoes", "view"))
    return (
      <div className="p-6">
        <EmptyStub
          title="Sem acesso"
          message="Você não tem permissão para acessar Configurações."
        />
      </div>
    );
  return (
    <div className="space-y-4 p-4 sm:p-6">
      {key && (
        <nav
          aria-label="Caminho das configurações"
          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Link
            to="/settings"
            className="rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Configurações
          </Link>
          {settingsTrail(key).map((label, index, trail) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <ChevronRight className="size-3" aria-hidden="true" />
              <span aria-current={index === trail.length - 1 ? "page" : undefined}>{label}</span>
            </span>
          ))}
        </nav>
      )}
      <PageHeader
        title={section?.label ?? "Configurações"}
        subtitle={section?.description ?? "Escolha uma área para configurar o sistema."}
        icon={Settings}
      />
      <Outlet />
    </div>
  );
}
