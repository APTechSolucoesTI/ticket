import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Search, FileText, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { escapePostgrestValue } from "@/lib/postgrest-escape";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/kb/")({
  head: () => ({
    meta: [
      { title: "Base de Conhecimento - APTicket" },
      { name: "description", content: "Artigos, tutoriais e procedimentos públicos." },
    ],
  }),
  component: KbPublicPage,
});

type Article = {
  id: string;
  title: string;
  slug: string;
  body: string;
  category_id: string | null;
  published_at: string | null;
};
type Category = { id: string; name: string; slug: string };

function stripHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function KbPublicPage() {
  const [q, setQ] = useState("");
  const [catId, setCatId] = useState<string | null>(null);

  const catsQ = useQuery({
    queryKey: ["kb-public-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kb_categories")
        .select("id,name,slug")
        .order("name");
      if (error) throw error;
      return data as Category[];
    },
  });

  const articlesQ = useQuery({
    queryKey: ["kb-public-articles", q, catId],
    queryFn: async () => {
      let query = supabase
        .from("kb_articles")
        .select("id,title,slug,body,category_id,published_at")
        .eq("status", "published")
        .eq("is_public", true)
        .order("published_at", { ascending: false })
        .limit(100);
      if (catId) query = query.eq("category_id", catId);
      if (q.trim()) {
        const term = escapePostgrestValue(`%${q}%`);
        query = query.or(`title.ilike.${term},body.ilike.${term}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Article[];
    },
  });

  const grouped = useMemo(() => {
    const cats = catsQ.data ?? [];
    const items = articlesQ.data ?? [];
    const usedCatIds = new Set(items.map((a) => a.category_id ?? "__none"));
    const byCat = new Map<string, Article[]>();
    for (const a of items) {
      const k = a.category_id ?? "__none";
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(a);
    }
    return { cats: cats.filter((c) => usedCatIds.has(c.id)), byCat };
  }, [catsQ.data, articlesQ.data]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao site
          </Link>
          <Link to="/auth" className="text-sm text-primary hover:underline">
            Área do cliente
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <BookOpen className="h-3.5 w-3.5" /> Base de Conhecimento
          </div>
          <h1 className="text-3xl md:text-4xl font-bold">Como podemos ajudar?</h1>
          <p className="text-muted-foreground">Encontre respostas, tutoriais e procedimentos.</p>
        </div>

        <Card className="p-4 flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por título ou conteúdo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={catId === null ? "default" : "outline"}
              onClick={() => setCatId(null)}
            >
              Todas
            </Button>
            {(catsQ.data ?? []).map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={catId === c.id ? "default" : "outline"}
                onClick={() => setCatId(c.id)}
              >
                {c.name}
              </Button>
            ))}
          </div>
        </Card>

        {articlesQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (articlesQ.data ?? []).length === 0 ? (
          <Card className="p-10 flex flex-col items-center justify-center text-center gap-2">
            <BookOpen className="h-8 w-8 text-muted-foreground" />
            <div className="font-medium">Nenhum artigo encontrado</div>
            <div className="text-sm text-muted-foreground">Ajuste a busca ou volte mais tarde.</div>
          </Card>
        ) : (
          <div className="space-y-6">
            {[...grouped.byCat.entries()].map(([cid, items]) => {
              const cat = grouped.cats.find((c) => c.id === cid);
              return (
                <div key={cid} className="space-y-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    {cat?.name ?? "Geral"}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {items.map((a) => (
                      <Link key={a.id} to="/kb/$slug" params={{ slug: a.slug }} className="block">
                        <Card className="p-4 h-full hover:border-primary/60 hover:shadow-premium transition group">
                          <div className="flex items-start gap-2">
                            <FileText className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold truncate group-hover:text-primary">
                                {a.title}
                              </div>
                              <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                                {stripHtml(a.body).slice(0, 160)}
                              </div>
                            </div>
                          </div>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
