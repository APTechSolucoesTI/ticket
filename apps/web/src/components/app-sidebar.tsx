import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Inbox,
  Building2,
  Users,
  FileText,
  BarChart3,
  Settings,
  BookOpen,
  Ticket,
  Monitor,
  MessageCircle,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";

// `module: null` = sempre visível (Dashboard não tem permissão própria).
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: null },
  { to: "/tickets", label: "Tickets", icon: Inbox, module: "tickets" },
  { to: "/whatsapp-pending", label: "Fila WhatsApp", icon: MessageCircle, module: "fila_whatsapp" },
  { to: "/email-pending", label: "Fila E-mail", icon: Mail, module: "fila_email" },
  { to: "/customers", label: "Clientes", icon: Building2, module: "clientes" },
  { to: "/contacts", label: "Contatos", icon: Users, module: "contatos" },
  { to: "/equipments", label: "Equipamentos", icon: Monitor, module: "equipamentos" },
  { to: "/contracts", label: "Contratos", icon: FileText, module: "contratos" },
  { to: "/kb/admin", label: "Base de Conhecimento", icon: BookOpen, module: "base_conhecimento" },
  { to: "/reports", label: "Relatórios", icon: BarChart3, module: "relatorios" },
  { to: "/settings", label: "Configurações", icon: Settings, module: "configuracoes" },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const perms = usePermissions();
  const nav = NAV.filter((item) => item.module === null || perms.has(item.module, "view"));

  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Ticket className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">APTicket</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Help Desk · PSA
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 text-sm">
        {nav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
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
        v0.1 · multi-tenant
      </div>
    </aside>
  );
}
