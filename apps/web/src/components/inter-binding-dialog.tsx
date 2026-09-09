import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2 } from "lucide-react";
import {
  listInterOperatingCompanies,
  getInterBindingReview,
  confirmInterBinding,
} from "@/lib/inter-binding.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";

const states = {
  company_tax_mismatch:
    "O CNPJ da empresa operadora diverge de Configurações > Empresa. Solicite a correção do cadastro.",
  configuration_missing:
    "Este ambiente ainda não foi configurado. Solicite o cadastro em Configurações > Banco Inter.",
  certificate_expired:
    "O certificado está vencido. Solicite a renovação em Configurações > Banco Inter.",
  confirmation_required: "Confira a empresa e a conta antes de confirmar este ambiente.",
  bound_to_another_company:
    "Este ambiente está vinculado a outra empresa. Solicite a revisão do vínculo.",
  confirmation_outdated:
    "A configuração mudou desde a última confirmação. Confira os dados e confirme novamente.",
  confirmed: "Vínculo interno confirmado para a configuração atual.",
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "Não informado";
const cnpj = (value: string | null) =>
  value?.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") ?? "CNPJ não informado";

export function InterBindingDialog({ onClose }: { onClose(): void }) {
  const [selected, setSelected] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [confirmation, setConfirmation] = useState("");
  const list = useServerFn(listInterOperatingCompanies);
  const getReview = useServerFn(getInterBindingReview);
  const confirm = useServerFn(confirmInterBinding);
  const companies = useQuery({
    queryKey: ["inter-operating-companies"],
    queryFn: () => list(),
    retry: 1,
  });
  const company = companies.data?.find((c) => c.id === selected) ?? companies.data?.[0];
  const query = useQuery({
    queryKey: ["inter-binding-review", company?.id, environment],
    queryFn: () => getReview({ data: { company: company!.id, environment } }),
    enabled: !!company,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const review = query.data;
  const token = `${company?.id}:${environment}:${review?.configuration_version}:${review?.binding_id}:${query.dataUpdatedAt}`;
  const mutation = useMutation({
    mutationFn: () =>
      confirm({
        data: {
          company: company!.id,
          environment,
          version: review!.configuration_version!,
          previous: review!.binding_id,
          confirmed: true,
        },
      }),
    onSuccess: async () => {
      setConfirmation("");
      await query.refetch();
    },
    onError: () => {
      setConfirmation("");
    },
  });
  const busy = mutation.isPending || query.isFetching;
  const eligible =
    review?.canConfirm &&
    ["confirmation_required", "confirmation_outdated"].includes(review.state) &&
    !!review.configuration_version;
  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="mr-5 flex items-center gap-2">
            <Building2 className="size-5 shrink-0" />
            Empresa operadora
          </DialogTitle>
          <DialogDescription>Vínculo bancário com o Inter por ambiente.</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Confirmar não emite boleto, não comprova titularidade bancária e não habilita envio ao
          banco.
        </p>
        {companies.isPending ? (
          <LoadingState />
        ) : companies.isError ? (
          <ErrorState
            title="Empresas indisponíveis"
            description={companies.error.message}
            action={{ label: "Tentar novamente", onClick: () => void companies.refetch() }}
          />
        ) : !company ? (
          <EmptyState
            title="Nenhuma empresa disponível"
            description="Não há empresa operadora provisionada ou você não possui acesso financeiro a ela. Solicite o vínculo ao administrador."
          />
        ) : (
          <>
            {(companies.data?.length ?? 0) > 1 && (
              <label className="space-y-1 text-sm">
                Empresa
                <select
                  aria-label="Empresa operadora"
                  className="w-full rounded-md border bg-background p-2"
                  value={company.id}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setConfirmation("");
                    mutation.reset();
                  }}
                >
                  {companies.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legal_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="min-w-0 rounded-lg border bg-muted/30 p-4">
              <p className="break-words font-semibold">{company.legal_name}</p>
              <p className="mt-1 text-sm text-muted-foreground">CNPJ {cnpj(company.tax_id)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Cadastro de referência: Configurações &gt; Empresa.
              </p>
            </div>
            <Tabs
              value={environment}
              onValueChange={(value) => {
                setEnvironment(value as typeof environment);
                setConfirmation("");
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
            {query.isPending ? (
              <LoadingState label="Consultando vínculo…" />
            ) : query.isError ? (
              <ErrorState
                title="Vínculo indisponível"
                description={query.error.message}
                action={{
                  label: "Tentar novamente",
                  onClick: () => {
                    setConfirmation("");
                    void query.refetch();
                  },
                }}
              />
            ) : (
              review && (
                <>
                  <div className="space-y-3 rounded-lg border p-4">
                    <Badge variant={review.state === "confirmed" ? "secondary" : "outline"}>
                      {review.state === "confirmed" ? "Confirmado" : "Revisão necessária"}
                    </Badge>
                    <p className="text-sm" role="status">
                      {states[review.state]}
                    </p>
                    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">Conta Inter</dt>
                        <dd>
                          {review.account_last_four
                            ? `Final ${review.account_last_four}`
                            : "Não configurada"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Versão da configuração</dt>
                        <dd>{review.configuration_version ?? "Não configurada"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Validade do certificado</dt>
                        <dd>{date(review.certificate_expires_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Última confirmação</dt>
                        <dd>{date(review.confirmed_at)}</dd>
                      </div>
                    </dl>
                    {review.binding_id && (
                      <p className="break-all text-xs text-muted-foreground">
                        Protocolo: {review.binding_id}
                      </p>
                    )}
                  </div>
                  {!review.canConfirm && (
                    <p className="text-sm text-muted-foreground">
                      Somente leitura. A confirmação exige perfil Admin ou Financeiro e acesso
                      financeiro de escrita à empresa.
                    </p>
                  )}
                  {eligible && (
                    <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        disabled={busy}
                        checked={confirmation === token}
                        onChange={(e) => setConfirmation(e.target.checked ? token : "")}
                      />
                      <span>
                        Confirmo o vínculo desta empresa com a conta final{" "}
                        {review.account_last_four} em{" "}
                        <strong>
                          {environment === "sandbox" ? "Homologação" : "Produção / Oficial"}
                        </strong>
                        . Esta confirmação não autoriza emissão de cobranças.
                      </span>
                    </label>
                  )}
                  {mutation.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      {mutation.error.message}
                    </p>
                  )}
                  {mutation.isSuccess && (
                    <p role="status" className="text-sm text-primary">
                      Confirmação registrada. Nenhuma cobrança foi enviada.
                    </p>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setConfirmation("");
                        mutation.reset();
                        void query.refetch();
                      }}
                    >
                      Atualizar consulta
                    </Button>
                    {eligible && (
                      <Button
                        disabled={busy || confirmation !== token}
                        onClick={() => mutation.mutate()}
                      >
                        {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                        Confirmar vínculo
                      </Button>
                    )}
                  </div>
                </>
              )
            )}
          </>
        )}
        <div className="flex justify-end">
          <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
