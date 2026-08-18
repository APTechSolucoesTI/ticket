import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Inbox, Building2, FileText, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/demo/Dashboard", label: "Dashboard",  icon: LayoutDashboard },
  { to: "/demo/Tickets",   label: "Tickets",    icon: Inbox },
  { to: "/demo/Clientes",  label: "Clientes",   icon: Building2 },
  { to: "/demo/Contratos", label: "Contratos",  icon: FileText },
] as const;

export function SidebarDemo() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Ticket className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">APTicket</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Modo demonstração</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 text-sm">
        {items.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3 text-[11px] text-muted-foreground">
        Dados fictícios · somente leitura
      </div>
    </aside>
  );
}
