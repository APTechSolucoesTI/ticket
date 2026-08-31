import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Sparkles, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarDemo } from "@/components/SidebarDemo";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Demonstração - APTicket" },
      { name: "description", content: "Explore o APTicket com dados fictícios: dashboard, tickets, clientes e contratos." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DemoLayout,
});

function DemoLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <SidebarDemo />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs flex items-center gap-2">
          <Sparkles className="size-3.5 text-amber-600 shrink-0" />
          <span className="text-amber-900 truncate">
            <b>Modo demonstração</b> · dados fictícios apenas para visualização.
          </span>
          <Button asChild size="sm" className="ml-auto h-7 gradient-primary text-white shrink-0">
            <Link to="/auth">Criar conta grátis</Link>
          </Button>
        </div>
        <header className="h-14 flex items-center border-b border-border bg-card px-4 gap-3 shrink-0">
          <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Voltar ao site
          </Link>
          <BrandLogo className="ml-2 size-8 drop-shadow-sm" alt="" />
          <div className="text-sm font-semibold">
            APTicket <span className="text-muted-foreground font-normal">(demo)</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
