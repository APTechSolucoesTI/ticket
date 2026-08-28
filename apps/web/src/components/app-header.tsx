import {
  Moon,
  Sun,
  LogOut,
  Search,
  Ticket,
  Building2,
  User,
  BookOpen,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { escapePostgrestValue } from "@/lib/postgrest-escape";
import { usePermissions } from "@/lib/use-permissions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MobileSidebar } from "@/components/app-sidebar";

type Result =
  | { kind: "ticket"; id: string; number: number; subject: string }
  | { kind: "company"; id: string; name: string }
  | { kind: "contact"; id: string; name: string; email: string | null }
  | { kind: "kb"; id: string; slug: string; title: string };

export function AppHeader({ title }: { title?: string }) {
  const { theme, toggle } = useTheme();
  const { user, signOut } = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const canTickets = permissions.has("tickets", "view");
  const canCompanies = permissions.has("clientes", "view");
  const canContacts = permissions.has("contatos", "view");
  const canKb = permissions.has("base_conhecimento", "view");
  const canSearch = canTickets || canCompanies || canContacts || canKb;

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const search = useQuery({
    queryKey: ["global-search", debounced, canTickets, canCompanies, canContacts, canKb],
    enabled: !permissions.loading && canSearch && debounced.length >= 2,
    queryFn: async (): Promise<Result[]> => {
      const term = escapePostgrestValue(`%${debounced}%`);
      const numeric = Number(debounced.replace(/\D/g, ""));
      const ticketsQ = canTickets
        ? supabase
            .from("tickets")
            .select("id, number, subject")
            .or(
              Number.isFinite(numeric) && numeric > 0
                ? `subject.ilike.${term},number.eq.${numeric}`
                : `subject.ilike.${term}`,
            )
            .order("created_at", { ascending: false })
            .limit(6)
        : Promise.resolve({ data: [], error: null });
      const companiesQ = canCompanies
        ? supabase.from("companies").select("id, name").ilike("name", `%${debounced}%`).limit(5)
        : Promise.resolve({ data: [], error: null });
      const contactsQ = canContacts
        ? supabase
            .from("contacts")
            .select("id, name, email")
            .or(`name.ilike.${term},email.ilike.${term}`)
            .limit(5)
        : Promise.resolve({ data: [], error: null });
      const kbQ = canKb
        ? supabase
            .from("kb_articles")
            .select("id, slug, title")
            .or(`title.ilike.${term},body.ilike.${term}`)
            .limit(5)
        : Promise.resolve({ data: [], error: null });

      const [t, c, ct, kb] = await Promise.all([ticketsQ, companiesQ, contactsQ, kbQ]);
      const out: Result[] = [];
      (t.data ?? []).forEach((r) =>
        out.push({ kind: "ticket", id: r.id, number: r.number, subject: r.subject }),
      );
      (c.data ?? []).forEach((r) => out.push({ kind: "company", id: r.id, name: r.name }));
      (ct.data ?? []).forEach((r) =>
        out.push({ kind: "contact", id: r.id, name: r.name, email: r.email }),
      );
      (kb.data ?? []).forEach((r) =>
        out.push({ kind: "kb", id: r.id, slug: r.slug, title: r.title }),
      );
      return out;
    },
  });

  const grouped = useMemo(() => {
    const r = search.data ?? [];
    return {
      tickets: r.filter((x) => x.kind === "ticket") as Extract<Result, { kind: "ticket" }>[],
      companies: r.filter((x) => x.kind === "company") as Extract<Result, { kind: "company" }>[],
      contacts: r.filter((x) => x.kind === "contact") as Extract<Result, { kind: "contact" }>[],
      kb: r.filter((x) => x.kind === "kb") as Extract<Result, { kind: "kb" }>[],
    };
  }, [search.data]);

  const go = (r: Result) => {
    setOpen(false);
    setQ("");
    if (r.kind === "ticket") navigate({ to: "/tickets/$id", params: { id: r.id } });
    else if (r.kind === "company") navigate({ to: "/customers" });
    else if (r.kind === "kb") navigate({ to: "/kb/$slug", params: { slug: r.slug } });
    else navigate({ to: "/contacts" });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth", replace: true });
  };

  const hasResults =
    grouped.tickets.length +
      grouped.companies.length +
      grouped.contacts.length +
      grouped.kb.length >
    0;
  const initials = (user?.name ?? user?.email ?? "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <MobileSidebar />
        {title && <h1 className="text-sm font-semibold truncate">{title}</h1>}
      </div>
      {canSearch && (
        <div className="min-w-0 flex-1 sm:max-w-md" ref={boxRef}>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => q && setOpen(true)}
              placeholder="Buscar tickets, clientes, contatos, base de conhecimento…"
              className="h-9 rounded-lg border-border bg-background pl-8 pr-14 text-sm shadow-none"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-2 hidden rounded border bg-card px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground sm:block">
              Ctrl K
            </kbd>
            {open && debounced.length >= 2 && (
              <div className="absolute left-0 right-0 top-11 z-50 rounded-md border border-border bg-popover shadow-lg max-h-[70vh] overflow-auto">
                {search.isFetching && (
                  <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…
                  </div>
                )}
                {!search.isFetching && !hasResults && (
                  <div className="p-3 text-xs text-muted-foreground">Nenhum resultado.</div>
                )}
                {grouped.tickets.length > 0 && (
                  <Section label="Tickets">
                    {grouped.tickets.map((r) => (
                      <button
                        key={`t-${r.id}`}
                        onClick={() => go(r)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                      >
                        <Ticket className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs text-muted-foreground">#{r.number}</span>
                        <span className="truncate">{r.subject}</span>
                      </button>
                    ))}
                  </Section>
                )}
                {grouped.companies.length > 0 && (
                  <Section label="Clientes">
                    {grouped.companies.map((r) => (
                      <button
                        key={`c-${r.id}`}
                        onClick={() => go(r)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                      >
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{r.name}</span>
                      </button>
                    ))}
                  </Section>
                )}
                {grouped.contacts.length > 0 && (
                  <Section label="Contatos">
                    {grouped.contacts.map((r) => (
                      <button
                        key={`ct-${r.id}`}
                        onClick={() => go(r)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                      >
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{r.name}</span>
                        {r.email && (
                          <span className="ml-auto text-xs text-muted-foreground truncate">
                            {r.email}
                          </span>
                        )}
                      </button>
                    ))}
                  </Section>
                )}
                {grouped.kb.length > 0 && (
                  <Section label="Base de conhecimento">
                    {grouped.kb.map((r) => (
                      <button
                        key={`kb-${r.id}`}
                        onClick={() => go(r)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                      >
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{r.title}</span>
                      </button>
                    ))}
                  </Section>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Alternar tema">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <div className="hidden items-center gap-2 md:flex">
          <div className="max-w-[160px] text-right leading-tight">
            <p className="truncate text-xs font-medium text-foreground">
              {user?.name ?? "Usuário"}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">{user?.email}</p>
          </div>
          <Avatar className="size-8 border">
            <AvatarFallback className="bg-primary/10 text-[10px] font-bold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>
        <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sair">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
