import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, Clock3, Loader2, LockKeyhole } from "lucide-react";
import { getInterChargeReview, prepareInterCharge } from "@/lib/inter-charges.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/data-state";
import { InterPayerReview } from "@/components/inter-payer-review";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
const requestStatus = {
  blocked_homologation: { label: "Aguardando emissão", icon: LockKeyhole },
  dispatching: { label: "Enviando ao Inter", icon: Clock3 },
  submitted: { label: "Aceita pelo Inter", icon: CheckCircle2 },
  uncertain: { label: "Resultado incerto", icon: CircleAlert },
  failed: { label: "Falha segura", icon: CircleAlert },
};

export function InterChargeDialog({ id, onClose }: { id: string; onClose(): void }) {
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [confirmed, setConfirmed] = useState(false);
  const getReview = useServerFn(getInterChargeReview);
  const prepare = useServerFn(prepareInterCharge);
  const query = useQuery({
    queryKey: ["inter-charge-review", id],
    queryFn: () => getReview({ data: { id } }),
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: () => prepare({ data: { id, environment, confirmed: true } }),
    onSuccess: async () => {
      setConfirmed(false);
      await query.refetch();
    },
  });
  const review = query.data;
  const receivable = review?.receivable;
  const existing = review?.requests.find((request) => request.environment === environment);
  const eligible =
    receivable?.status_cobranca === "a_faturar" &&
    Number(receivable.valor_aberto) > 0 &&
    Number(receivable.valor_aberto) === Number(receivable.valor_original);
  const changed =
    existing &&
    receivable &&
    (Number(existing.amount) !== Number(receivable.valor_aberto) ||
      existing.due_date !== receivable.vencimento_em ||
      !!existing.deleted_at);
  const status = existing ? requestStatus[existing.status] : null;
  const busy = mutation.isPending || query.isFetching;
  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="mr-4">Preparação de cobrança Inter</DialogTitle>
          <DialogDescription>
            Conferência do recebível e das solicitações por ambiente.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" />
          {environment === "sandbox" ? (
            <p>
              A emissão em homologação é manual e exige confirmação do pagador. Preparar, sozinho,
              não envia dados ao banco nem altera o status financeiro.
            </p>
          ) : (
            <p>
              A emissão oficial exige confirmação explícita e só ficará disponível com a
              configuração de produção ativa, vínculo confirmado e webhook registrado. Preparar não
              envia dados ao banco.
            </p>
          )}
        </div>
        {query.isPending ? (
          <LoadingState label="Carregando preparação…" />
        ) : query.isError ? (
          <ErrorState
            title="Cobrança indisponível"
            description={query.error.message}
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : (
          receivable && (
            <>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="break-all text-xs text-muted-foreground">
                  {receivable.documento_referencia}
                </p>
                <p className="mt-1 break-words font-semibold">{receivable.cliente_nome}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Saldo atual</p>
                    <p className="mt-1 text-lg font-bold tabular-nums">
                      {money.format(receivable.valor_aberto)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Vencimento atual</p>
                    <p className="mt-1 font-medium">{date(receivable.vencimento_em)}</p>
                  </div>
                </div>
              </div>
              <Tabs
                value={environment}
                onValueChange={(value) => {
                  setEnvironment(value as typeof environment);
                  setConfirmed(false);
                  mutation.reset();
                }}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="sandbox" disabled={busy}>
                    Homologação
                  </TabsTrigger>
                  <TabsTrigger value="production" disabled={busy}>
                    Produção / Oficial
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {existing ? (
                <section
                  className="space-y-2 rounded-lg border p-4"
                  aria-label="Solicitação registrada"
                >
                  {status && (
                    <Badge variant="outline" className="gap-1">
                      <status.icon className="size-3" /> {status.label}
                    </Badge>
                  )}
                  <p className="text-sm">
                    Preparado: <strong>{money.format(existing.amount)}</strong> · Vencimento:{" "}
                    {date(existing.due_date)}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    Protocolo: {existing.id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Registrado em {new Date(existing.created_at).toLocaleString("pt-BR")}
                  </p>
                  {changed && (
                    <p role="alert" className="text-sm text-destructive">
                      O recebível mudou ou a solicitação foi desativada. Solicite revisão antes da
                      emissão. A preparação original não será sobrescrita.
                    </p>
                  )}
                </section>
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhuma solicitação neste ambiente.
                </p>
              )}
              {existing && !changed && (
                <InterPayerReview
                  key={`${environment}-${existing.id}`}
                  request={existing}
                  onRequestChanged={() => {
                    mutation.reset();
                    return query.refetch();
                  }}
                />
              )}
              {!review?.canPrepare && (
                <p role="status" className="text-sm text-muted-foreground">
                  Somente leitura. É necessário acesso financeiro de escrita a esta empresa para
                  preparar.
                </p>
              )}
              {!existing && !eligible && (
                <p role="alert" className="text-sm text-destructive">
                  Preparação indisponível: o recebível deve estar a faturar, com saldo positivo e
                  sem baixa parcial.
                </p>
              )}
              {!existing && review?.canPrepare && eligible && (
                <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    Conferi o recebível e confirmo a preparação em{" "}
                    <strong>
                      {environment === "sandbox" ? "Homologação" : "Produção / Oficial"}
                    </strong>
                    . Sei que não haverá envio ao banco nesta etapa.
                  </span>
                </label>
              )}
              {mutation.isSuccess && (
                <p role="status" className="rounded-lg bg-primary/5 p-3 text-sm">
                  {mutation.data.reused
                    ? "Solicitação existente localizada."
                    : "Preparação registrada."}{" "}
                  Nenhuma cobrança foi enviada ao Inter.
                </p>
              )}
              {mutation.isError && (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {mutation.error.message}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void query.refetch()}>
                  Atualizar consulta
                </Button>
                {!existing && review?.canPrepare && (
                  <Button
                    disabled={busy || !eligible || !confirmed}
                    onClick={() => mutation.mutate()}
                  >
                    {mutation.isPending && <Loader2 className="size-4 animate-spin" />}Registrar
                    preparação
                  </Button>
                )}
              </div>
            </>
          )
        )}
        <div className="flex justify-end">
          <Button variant="ghost" disabled={mutation.isPending} onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
