import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Settings } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import {
  SETTINGS_SECTIONS,
  visibleSettingsNavigation,
  type SettingsNode,
} from "@/lib/settings-navigation";

function containsPath(nodes: readonly SettingsNode[], pathname: string): boolean {
  return nodes.some((node) =>
    typeof node === "string"
      ? SETTINGS_SECTIONS[node].path === pathname.replace(/\/$/, "")
      : containsPath(node.children, pathname),
  );
}

function SettingsGroup({
  label,
  active,
  children,
  root = false,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
  root?: boolean;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [state, setState] = useState({ pathname, open: active });
  // Follow the current location, while allowing the user to collapse its group.
  const open = state.pathname === pathname ? state.open : active;
  return (
    <Collapsible open={open} onOpenChange={(next) => setState({ pathname, open: next })}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            root && "px-3 text-[13px]",
            active ? "font-semibold text-primary" : "text-sidebar-foreground",
          )}
        >
          {root && <Settings className="size-4 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 flex-1">{label}</span>
          <ChevronDown
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn("ml-2 space-y-0.5 border-l border-sidebar-border pl-2", root && "ml-5")}>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SettingsLinks({
  nodes,
  pathname,
  closeOnNavigate,
}: {
  nodes: readonly SettingsNode[];
  pathname: string;
  closeOnNavigate: boolean;
}) {
  return nodes.map((node) => {
    if (typeof node !== "string")
      return (
        <SettingsGroup
          key={node.id}
          label={node.label}
          active={containsPath(node.children, pathname)}
        >
          <SettingsLinks
            nodes={node.children}
            pathname={pathname}
            closeOnNavigate={closeOnNavigate}
          />
        </SettingsGroup>
      );
    const section = SETTINGS_SECTIONS[node];
    const active = section.path === pathname.replace(/\/$/, "");
    const link = (
      <Link
        to={section.path}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-8 items-center rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          active
            ? "bg-primary/10 font-semibold text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {section.label}
      </Link>
    );
    return closeOnNavigate ? (
      <SheetClose key={node} asChild>
        {link}
      </SheetClose>
    ) : (
      <div key={node}>{link}</div>
    );
  });
}

export function SettingsNavigation({ closeOnNavigate }: { closeOnNavigate: boolean }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const permissions = usePermissions();
  const nodes = visibleSettingsNavigation((module) => permissions.has(module, "view"));
  const overview = (
    <Link
      to="/settings"
      activeOptions={{ exact: true }}
      aria-current={pathname === "/settings" || pathname === "/settings/" ? "page" : undefined}
      className="flex min-h-8 items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:font-semibold aria-[current=page]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      Visão geral
    </Link>
  );
  return (
    <SettingsGroup
      label="Configurações"
      active={pathname === "/settings" || pathname.startsWith("/settings/")}
      root
    >
      {closeOnNavigate ? <SheetClose asChild>{overview}</SheetClose> : overview}
      <SettingsLinks nodes={nodes} pathname={pathname} closeOnNavigate={closeOnNavigate} />
    </SettingsGroup>
  );
}
