import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  SETTINGS_SECTIONS,
  visibleSettingsNavigation,
  type SettingsNode,
} from "@/lib/settings-navigation";
import { usePermissions } from "@/lib/use-permissions";

export const Route = createFileRoute("/_authenticated/settings/")({ component: SettingsDirectory });

function SectionLinks({ nodes }: { nodes: readonly SettingsNode[] }) {
  return (
    <div className="divide-y">
      {nodes.map((node) => {
        if (typeof node !== "string")
          return (
            <div key={node.id} className="py-3">
              <h3 className="mb-1 px-4 text-xs font-semibold text-muted-foreground">
                {node.label}
              </h3>
              <SectionLinks nodes={node.children} />
            </div>
          );
        const section = SETTINGS_SECTIONS[node];
        return (
          <Link
            key={node}
            to={section.path}
            className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium group-hover:text-primary">{section.label}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{section.description}</p>
            </div>
            <ArrowUpRight
              className="size-4 shrink-0 text-muted-foreground group-hover:text-primary"
              aria-hidden="true"
            />
          </Link>
        );
      })}
    </div>
  );
}

function SettingsDirectory() {
  const permissions = usePermissions();
  const nodes = visibleSettingsNavigation((module) => permissions.has(module, "view"));
  return (
    <div className="space-y-5">
      {nodes.includes("company") && (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-3">
            <Building2 className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Sua empresa</h2>
          </div>
          <SectionLinks nodes={["company"]} />
        </Card>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        {nodes
          .filter((node) => typeof node !== "string")
          .map((node) => (
            <Card key={node.id} className="gap-0 overflow-hidden py-0">
              <h2 className="border-b bg-muted/30 px-4 py-3 text-sm font-semibold">{node.label}</h2>
              <SectionLinks nodes={node.children} />
            </Card>
          ))}
      </div>
    </div>
  );
}
