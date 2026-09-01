import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getUserFacingError } from "@/lib/user-facing-error";

export const Route = createFileRoute("/csat/$token")({
  head: () => ({ meta: [{ title: "Avaliar atendimento - APTicket" }] }),
  component: CsatPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-center text-sm text-destructive">Erro: {error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-8 text-center text-sm">Pesquisa não encontrada ou já respondida.</div>
  ),
});

function CsatPage() {
  const { token } = Route.useParams();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["csat", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_csat_by_token", { _token: token });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw notFound();
      return row as { id: string; rating: number | null; responded_at: string | null };
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!rating) throw new Error("Selecione uma nota");
      const { error } = await supabase.rpc("submit_csat", {
        _token: token,
        _rating: rating,
        _comment: comment || "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDone(true);
      toast.success("Obrigado pelo feedback!");
    },
    onError: (e: Error) =>
      toast.error(getUserFacingError(e, "Não foi possível enviar a avaliação.")),
  });

  if (isLoading)
    return <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>;

  if (done || data?.responded_at) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-2xl font-semibold">Obrigado!</h1>
        <p className="text-sm text-muted-foreground">Sua avaliação foi registrada.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="mb-2 text-2xl font-semibold">Como foi seu atendimento?</h1>
      <p className="mb-6 text-sm text-muted-foreground">Sua opinião nos ajuda a melhorar.</p>
      <div className="mb-4 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="transition"
          >
            <Star
              className={cn(
                "h-10 w-10",
                (hover || rating) >= n
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground",
              )}
            />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comentário (opcional)"
        className="mb-4 w-full resize-none rounded-md border bg-background p-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        rows={4}
      />
      <Button
        onClick={() => submit.mutate()}
        disabled={submit.isPending || !rating}
        className="w-full"
      >
        Enviar avaliação
      </Button>
    </div>
  );
}
