import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  FileText,
  Headset,
  Inbox,
  LayoutDashboard,
  Mail,
  Menu,
  MessageCircle,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

type NavSection = {
  id: "principal" | "atendimento" | "gestao" | "administracao";
  label: string;
  icon: LucideIcon;
  collapsible: boolean;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    id: "principal",
    label: "Principal",
    icon: LayoutDashboard,
    collapsible: false,
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: null }],
  },
  {
    id: "atendimento",
    label: "Atendimento",
    icon: Headset,
    collapsible: true,
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
    id: "gestao",
    label: "Gestão",
    icon: BriefcaseBusiness,
    collapsible: true,
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
    id: "administracao",
    label: "Administração",
    icon: ShieldCheck,
    collapsible: true,
    items: [{ to: "/settings", label: "Configurações", icon: Settings, module: "configuracoes" }],
  },
];

type OpenSections = Record<NavSection["id"], boolean>;

function getInitialOpenSections(pathname: string): OpenSections {
  return Object.fromEntries(
    NAV_SECTIONS.map((section) => [
      section.id,
      !section.collapsible ||
        section.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)),
    ]),
  ) as OpenSections;
}

function Brand({ collapsed, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center border-b border-sidebar-border transition-[padding] duration-200",
        collapsed ? "justify-center gap-1 px-1.5" : "gap-2.5 px-4",
      )}
    >
      {!collapsed && (
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-dark text-white shadow-sm dark:bg-white dark:text-slate-900">
          <Ticket className="size-4" />
        </div>
      )}
      {!collapsed && (
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-sm font-bold text-foreground">APTicket</div>
          <div className="truncate text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Help Desk · PSA
          </div>
        </div>
      )}
      {onToggle && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onToggle}
          aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          title={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      )}
    </div>
  );
}

function SidebarNavigation({
  closeOnNavigate = false,
  collapsed = false,
  onExpand,
}: {
  closeOnNavigate?: boolean;
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const permissions = usePermissions();
  const [openSections, setOpenSections] = useState<OpenSections>(() =>
    getInitialOpenSections(pathname),
  );

  const toggleSection = (section: NavSection) => {
    if (collapsed) {
      onExpand?.();
      setOpenSections((current) => ({ ...current, [section.id]: true }));
      return;
    }
    setOpenSections((current) => ({ ...current, [section.id]: !current[section.id] }));
  };

  return (
    <nav
      className={cn(
        "flex-1 space-y-2 overflow-x-hidden overflow-y-auto py-3 transition-[padding] duration-200",
        collapsed ? "px-1.5" : "px-2",
      )}
      aria-label="Menu principal"
    >
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter(
          (item) => item.module === null || permissions.has(item.module, "view"),
        );
        if (items.length === 0) return null;

        if (!section.collapsible) {
          return (
            <section
              key={section.id}
              aria-labelledby={collapsed ? undefined : `nav-${section.id}`}
              aria-label={collapsed ? section.label : undefined}
            >
              {!collapsed && (
                <h2
                  id={`nav-${section.id}`}
                  className="mb-1 rounded-md bg-muted/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground dark:bg-white/[0.045]"
                >
                  <span className="mr-2 inline-block h-3 w-0.5 rounded-full bg-primary align-middle" />
                  {section.label}
                </h2>
              )}
              <NavItems
                items={items}
                pathname={pathname}
                closeOnNavigate={closeOnNavigate}
                collapsed={collapsed}
              />
            </section>
          );
        }

        const SectionIcon = section.icon;
        const isOpen = openSections[section.id];
        return (
          <Collapsible
            key={section.id}
            open={!collapsed && isOpen}
            onOpenChange={() => toggleSection(section)}
            asChild
          >
            <section aria-labelledby={`nav-${section.id}`}>
              <CollapsibleTrigger asChild>
                <button
                  id={`nav-${section.id}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    collapsed
                      ? "h-10 justify-center px-2"
                      : "mb-1 h-8 gap-2 bg-muted/80 px-3 dark:bg-white/[0.045]",
                  )}
                  aria-label={collapsed ? `Expandir menu ${section.label}` : undefined}
                  title={collapsed ? section.label : undefined}
                >
                  {collapsed ? (
                    <SectionIcon className="size-4" aria-hidden="true" />
                  ) : (
                    <>
                      <span className="h-3 w-0.5 shrink-0 rounded-full bg-primary" />
                      <span className="flex-1 text-left text-[10px] font-semibold uppercase tracking-[0.1em]">
                        {section.label}
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 transition-transform duration-200",
                          isOpen && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                    </>
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden">
                <NavItems items={items} pathname={pathname} closeOnNavigate={closeOnNavigate} />
              </CollapsibleContent>
            </section>
          </Collapsible>
        );
      })}
    </nav>
  );
}

function NavItems({
  items,
  pathname,
  closeOnNavigate,
  collapsed = false,
}: {
  items: NavItem[];
  pathname: string;
  closeOnNavigate: boolean;
  collapsed?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      {items.map((item) => {
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
        const Icon = item.icon;
        const link = (
          <Link
            to={item.to}
            className={cn(
              "flex h-8 items-center rounded-md text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapsed ? "justify-center px-2" : "gap-2.5 px-3",
              active
                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-muted hover:text-foreground",
            )}
            aria-label={collapsed ? item.label : undefined}
            title={collapsed ? item.label : undefined}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span className="truncate">{item.label}</span>}
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
  );
}

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out lg:flex",
        collapsed ? "w-[4.25rem]" : "w-60",
      )}
    >
      <Brand collapsed={collapsed} onToggle={() => setCollapsed((current) => !current)} />
      <SidebarNavigation collapsed={collapsed} onExpand={() => setCollapsed(false)} />
      {!collapsed && (
        <div className="border-t border-sidebar-border px-4 py-2.5 text-[10px] text-muted-foreground">
          v0.1 · multi-tenant
        </div>
      )}
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
