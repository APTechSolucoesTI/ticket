import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "@/components/empty-stub";
import { financeNavigation } from "@/lib/finance-navigation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Financeiro - APTicket" }] }),
  component: FinanceLayout,
});

function FinanceLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Financeiro"
        subtitle="Recebimentos, pagamentos, bancos, planejamento e resultados em áreas especializadas."
      />
      <nav
        aria-label="Áreas do financeiro"
        className="overflow-x-auto rounded-xl border bg-card p-1.5 shadow-sm"
      >
        <div className="flex min-w-max gap-1">
          {financeNavigation.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === "/finance"
                ? pathname === "/finance" || pathname === "/finance/"
                : pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden xl:inline">{item.label}</span>
                <span className="xl:hidden">{item.shortLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
