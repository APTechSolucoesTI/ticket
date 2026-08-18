import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/kb/$slug")({
  head: () => ({ meta: [{ title: "Artigo — Base de Conhecimento" }] }),
  component: KbArticlePublicPage,
});

function KbArticlePublicPage() {
  const { slug } = useParams({ from: "/kb/$slug" });

  const q = useQuery({
    queryKey: ["kb-public-article", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kb_articles")
        .select("id,title,slug,body,published_at")
        .eq("slug", slug)
        .eq("is_public", true)
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <Link to="/kb">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Base de Conhecimento
            </Button>
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : !q.data ? (
          <Card className="p-10 text-center text-muted-foreground">Artigo não encontrado.</Card>
        ) : (
          <>
            <div className="space-y-2">
              {q.data.published_at && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(q.data.published_at).toLocaleDateString("pt-BR")}
                </span>
              )}
              <h1 className="text-3xl font-bold">{q.data.title}</h1>
            </div>
            <Card className="p-6">
              <div
                className="prose prose-sm dark:prose-invert max-w-none prose-a:text-primary"
                // Article body is agent-authored rich text (Tiptap) stored as raw HTML.
                // Sanitize before injecting: this page is public/unauthenticated, so a
                // compromised or malicious agent account must not be able to plant
                // stored XSS here.
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(q.data.body || "<p><em>Sem conteúdo.</em></p>", {
                    ALLOWED_TAGS: [
                      "p",
                      "br",
                      "strong",
                      "em",
                      "u",
                      "s",
                      "a",
                      "ul",
                      "ol",
                      "li",
                      "h1",
                      "h2",
                      "h3",
                      "blockquote",
                      "code",
                      "pre",
                    ],
                    ALLOWED_ATTR: ["href", "target", "rel"],
                    ALLOW_DATA_ATTR: false,
                  }),
                }}
              />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
