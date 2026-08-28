import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Building2,
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  Menu,
  MessageCircle,
  Monitor,
  Settings,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  module: string | null;
};

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Principal",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: null }],
  },
  {
    label: "Atendimento",
    items: [
      { to: "/tickets", label: "Tickets", icon: Inbox, module: "tickets" },
      {
        to: "/whatsapp-pending",
        label: "Fila WhatsApp",
        icon: MessageCircle,
        module: "fila_whatsapp",
      },
      { to: "/email-pending", label: "Fila E-mail", icon: Mail, module: "fila_email" },
      { to: "/contacts", label: "Contatos", icon: Users, module: "contatos" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { to: "/customers", label: "Clientes", icon: Building2, module: "clientes" },
      { to: "/equipments", label: "Equipamentos", icon: Monitor, module: "equipamentos" },
      { to: "/contracts", label: "Contratos", icon: FileText, module: "contratos" },
      {
        to: "/kb/admin",
        label: "Base de Conhecimento",
        icon: BookOpen,
        module: "base_conhecimento",
      },
      { to: "/reports", label: "Relatórios", icon: BarChart3, module: "relatorios" },
    ],
  },
  {
    label: "Administração",
    items: [{ to: "/settings", label: "Configurações", icon: Settings, module: "configuracoes" }],
  },
];

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
      <div className="grid size-8 place-items-center rounded-lg bg-brand-dark text-white shadow-sm dark:bg-white dark:text-slate-900">
        <Ticket className="size-4" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-bold text-foreground">APTicket</div>
        <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Help Desk · PSA
        </div>
      </div>
    </div>
  );
}

function SidebarNavigation({ closeOnNavigate = false }: { closeOnNavigate?: boolean }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const permissions = usePermissions();

  return (
    <nav className="flex-1 space-y-2 overflow-y-auto px-2 py-3" aria-label="Menu principal">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter(
          (item) => item.module === null || permissions.has(item.module, "view"),
        );
        if (items.length === 0) return null;
        return (
          <section key={section.label} aria-labelledby={`nav-${section.label}`}>
            <h2
              id={`nav-${section.label}`}
              className="mb-1 rounded-md bg-muted/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground dark:bg-white/[0.045]"
            >
              <span className="mr-2 inline-block h-3 w-0.5 rounded-full bg-primary align-middle" />
              {section.label}
            </h2>
            <div className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                const Icon = item.icon;
                const link = (
                  <Link
                    to={item.to}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      active
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
                return closeOnNavigate ? (
                  <SheetClose key={item.to} asChild>
                    {link}
                  </SheetClose>
                ) : (
                  <div key={item.to}>{link}</div>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

export function AppSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <Brand />
      <SidebarNavigation />
      <div className="border-t border-sidebar-border px-4 py-2.5 text-[10px] text-muted-foreground">
        v0.1 · multi-tenant
      </div>
    </aside>
  );
}

export function MobileSidebar() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
        <SheetTitle className="sr-only">Menu principal</SheetTitle>
        <SheetDescription className="sr-only">Navegação do APTicket</SheetDescription>
        <Brand />
        <SidebarNavigation closeOnNavigate />
      </SheetContent>
    </Sheet>
  );
}
