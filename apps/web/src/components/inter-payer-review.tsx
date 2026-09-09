import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  UserRoundCheck,
} from "lucide-react";
import {
  confirmInterPayer,
  emitInterSandboxCharge,
  getInterPayerReview,
  type InterChargeRequest,
  type InterPayerReview as Review,
} from "@/lib/inter-charges.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/data-state";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const missingLabels: Record<Review["missing_fields"][number], string> = {
  name: "Nome / razão social",
  tax_id: "CNPJ",
  street: "Logradouro",
  number: "Número",
  district: "Bairro",
  city: "Cidade",
  state: "UF",
  zip: "CEP",
  phone: "Telefone",
  amount: "Valor da cobrança",
  due_date: "Vencimento",
  receivable: "Situação ou saldo do recebível",
};
const onlyDigits = (value: string | null) => value?.replace(/\D/g, "") ?? "";
const formatTaxId = (value: string | null) => {
  const digits = onlyDigits(value);
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value || "Não informado";
};
const formatZip = (value: string | null) => {
  const digits = onlyDigits(value);
  return digits.length === 8
    ? digits.replace(/^(\d{5})(\d{3})$/, "$1-$2")
    : value || "Não informado";
};
const valueOrMissing = (value: string | null) => value?.trim() || "Não informado";

export function InterPayerReview({
  request,
  onRequestChanged,
}: {
  request: InterChargeRequest;
  onRequestChanged(): Promise<unknown>;
}) {
  const requestId = request.id;
  const [confirmationToken, setConfirmationToken] = useState("");
  const [dispatchToken, setDispatchToken] = useState("");
  const getReview = useServerFn(getInterPayerReview);
  const confirm = useServerFn(confirmInterPayer);
  const emit = useServerFn(emitInterSandboxCharge);
  const query = useQuery({
    queryKey: ["inter-payer-review", requestId],
    queryFn: () => getReview({ data: { id: requestId } }),
    staleTime: 0,
  });
  const review = query.data;
  const currentToken = review
    ? `${review.source_fingerprint}|${review.binding_id ?? ""}|${review.snapshot_id ?? ""}`
    : "";
  const checked = !!currentToken && confirmationToken === currentToken;
  const mutation = useMutation({
    mutationFn: () => {
      if (!review?.binding_id) throw new Error("Vínculo bancário indisponível para confirmação.");
      return confirm({
        data: {
          id: requestId,
          sourceFingerprint: review.source_fingerprint,
          binding: review.binding_id,
          previous: review.snapshot_id,
          confirmed: true,
        },
      });
    },
    onSuccess: async () => {
      setConfirmationToken("");
      await query.refetch();
    },
  });
  const dispatchMutation = useMutation({
    mutationFn: () => emit({ data: { id: requestId, confirmed: true } }),
    onSuccess: async () => {
      setDispatchToken("");
      mutation.reset();
      await Promise.all([query.refetch(), onRequestChanged()]);
    },
  });
  if (query.isPending) return <LoadingState label="Revisando dados do pagador…" />;
  if (query.isError)
    return (
      <ErrorState
        title="Dados do pagador indisponíveis"
        description={query.error.message}
        action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
      />
    );
  if (!review) return null;
  const confirmable = ["confirmation_required", "confirmation_outdated"].includes(review.state);
  const dispatchable =
    request.environment === "sandbox" &&
    review.state === "confirmed" &&
    review.canConfirm &&
    ["blocked_homologation", "failed"].includes(request.status);
  const dispatchConfirmation = `${request.id}|${request.updated_at}|${request.dispatch_attempts}`;
  const dispatchChecked = dispatchToken === dispatchConfirmation;
  const address = [review.payer.street, review.payer.number, review.payer.complement]
    .filter(Boolean)
    .join(", ");
  const city = [review.payer.district, review.payer.city, review.payer.state]
    .filter(Boolean)
    .join(" · ");
  const phone = review.payer.phone
    ? `${review.payer.ddd ? `(${review.payer.ddd}) ` : ""}${review.payer.phone}`
    : "Não informado";
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-labelledby="payer-review-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="payer-review-title" className="flex items-center gap-2 font-semibold">
            <UserRoundCheck className="size-4 text-primary" /> Dados do pagador
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Snapshot usado futuramente na emissão da cobrança deste ambiente.
          </p>
        </div>
        {review.state === "confirmed" ? (
          <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
            <CheckCircle2 className="size-3" /> Pagador confirmado
          </Badge>
        ) : review.state === "missing_data" ? (
          <Badge variant="destructive">Cadastro incompleto</Badge>
        ) : review.state === "binding_required" ? (
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            Vínculo bancário necessário
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            {review.state === "confirmation_outdated"
              ? "Confirmação desatualizada"
              : "Confirmação necessária"}
          </Badge>
        )}
      </div>

      <div className="grid gap-x-4 gap-y-3 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <p className="text-xs text-muted-foreground">Nome / razão social</p>
          <p className="break-words font-medium">{valueOrMissing(review.payer.name)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">CNPJ</p>
          <p className="font-medium tabular-nums">{formatTaxId(review.payer.tax_id)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Telefone</p>
          <p className="font-medium">{phone}</p>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <p className="text-xs text-muted-foreground">Endereço</p>
          <p className="break-words font-medium">{address || "Não informado"}</p>
          <p className="break-words text-xs text-muted-foreground">
            {city || "Localidade não informada"} · CEP {formatZip(review.payer.zip)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Valor e vencimento</p>
          <p className="font-medium tabular-nums">
            {money.format(review.amount)} ·{" "}
            {new Date(`${review.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Seu número</p>
          <p className="break-all font-medium">{review.seu_numero}</p>
        </div>
      </div>

      {review.state === "missing_data" && (
        <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Complete os dados antes de confirmar.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {review.missing_fields.map((field) => (
                  <Badge key={field} variant="outline" className="bg-background">
                    {missingLabels[field]}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/customers">Abrir cadastro de clientes</Link>
          </Button>
        </div>
      )}

      {review.state === "binding_required" && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Confirme primeiro o vínculo deste ambiente em{" "}
          <strong>Financeiro → Empresa operadora</strong>e depois atualize esta consulta.
        </p>
      )}

      {confirmable && review.canConfirm && (
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={checked}
            disabled={mutation.isPending || query.isFetching}
            onChange={(event) => setConfirmationToken(event.target.checked ? currentToken : "")}
          />
          <span>
            Conferi os dados exibidos e autorizo o registro deste snapshot. Esta confirmação ainda
            não emite boleto nem envia dados ao Banco Inter.
          </span>
        </label>
      )}

      {confirmable && !review.canConfirm && (
        <p role="status" className="text-sm text-muted-foreground">
          Somente leitura. A confirmação exige perfil Admin ou Financeiro com acesso financeiro de
          escrita à empresa.
        </p>
      )}

      {review.state === "confirmed" && review.confirmed_at && (
        <p role="status" className="text-sm text-muted-foreground">
          Dados confirmados em {new Date(review.confirmed_at).toLocaleString("pt-BR")}. Alterações
          no cadastro exigirão uma nova confirmação.
        </p>
      )}

      {request.environment === "production" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            Emissão oficial bloqueada. A produção será liberada somente depois da homologação e das
            validações de segurança.
          </p>
        </div>
      )}

      {request.status === "dispatching" && (
        <div role="status" className="flex items-start gap-2 rounded-md bg-blue-500/10 p-3 text-sm">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-blue-700" />
          <p>A solicitação está sendo enviada ao Inter. Atualize a consulta em instantes.</p>
        </div>
      )}
      {request.status === "submitted" && (
        <div
          role="status"
          className="space-y-1 rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900"
        >
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4" /> Solicitação aceita pelo Inter
          </p>
          <p>O processamento bancário está em andamento.</p>
          {request.bank_request_id && (
            <p className="break-all text-xs">Código da solicitação: {request.bank_request_id}</p>
          )}
        </div>
      )}
      {request.status === "uncertain" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            O resultado do envio é incerto. Por segurança, o sistema não repetirá a cobrança
            automaticamente. Revise o histórico antes de qualquer ação manual.
          </p>
        </div>
      )}
      {request.status === "failed" && (
        <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">
          {request.last_error_message ||
            "A emissão falhou antes de uma confirmação bancária. Revise os dados para tentar novamente."}
        </p>
      )}

      {dispatchable && (
        <label className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={dispatchChecked}
            disabled={dispatchMutation.isPending || query.isFetching}
            onChange={(event) => setDispatchToken(event.target.checked ? dispatchConfirmation : "")}
          />
          <span>
            Estou no ambiente de <strong>Homologação</strong>, conferi o pagador, o valor e o
            vencimento, e autorizo o envio desta cobrança de teste ao Banco Inter.
          </span>
        </label>
      )}

      {dispatchMutation.isSuccess && (
        <p role="status" className="rounded-md bg-primary/5 p-3 text-sm">
          {dispatchMutation.data.message}
        </p>
      )}
      {dispatchMutation.isError && (
        <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">
          {dispatchMutation.error.message}
        </p>
      )}

      {mutation.isSuccess && (
        <p role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800">
          {mutation.data.reused
            ? "Confirmação existente localizada."
            : "Dados do pagador confirmados."}{" "}
          Nenhuma cobrança foi enviada ao Inter.
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={mutation.isPending || dispatchMutation.isPending || query.isFetching}
          onClick={() => void Promise.all([query.refetch(), onRequestChanged()])}
        >
          <RefreshCw className={query.isFetching ? "animate-spin" : ""} /> Atualizar pagador
        </Button>
        {confirmable && review.canConfirm && (
          <Button
            size="sm"
            disabled={!checked || mutation.isPending || query.isFetching}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />} Confirmar pagador
          </Button>
        )}
        {dispatchable && (
          <Button
            size="sm"
            disabled={!dispatchChecked || dispatchMutation.isPending || query.isFetching}
            onClick={() => dispatchMutation.mutate()}
          >
            {dispatchMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Emitir no sandbox
          </Button>
        )}
      </div>
    </section>
  );
}
