import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, CircleDollarSign, Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReadOnlyNotice, useModulePermissions } from "@/lib/permission-ui";
import {
  saveFinancialSettings,
  useFinancialSettings,
  type FinancialSettings,
} from "@/lib/financial-settings";
import { getUserFacingError } from "@/lib/user-facing-error";

export function FinancialTab() {
  const access = useModulePermissions("configuracoes");
  const query = useFinancialSettings();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<FinancialSettings>();
  const value = draft ?? query.data;
  const save = useMutation({
    mutationFn: saveFinancialSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["financial-settings"] });
      setDraft(undefined);
      toast.success("Configurações financeiras salvas.");
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "salvar as configurações financeiras")),
  });
  if (query.isLoading) return <LoadingState label="Carregando configurações financeiras…" />;
  if (query.isError || !value)
    return (
      <ErrorState
        title="Configurações financeiras indisponíveis"
        description="Não foi possível consultar as funcionalidades do financeiro."
        action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
      />
    );
  const changed = Boolean(
    draft &&
    (draft.use_payable_approvals !== query.data?.use_payable_approvals ||
      draft.use_collection_rules !== query.data?.use_collection_rules),
  );
  const disabled = !access.edit || save.isPending;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <CircleDollarSign className="size-5 text-primary" />
          Financeiro
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure as funcionalidades financeiras para todas as empresas operadoras.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <ReadOnlyNotice show={!access.edit} />
        <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-[1fr_200px] sm:items-center sm:gap-6 sm:p-5">
          <div>
            <h3 className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4 text-primary" />
              Contas a pagar
            </h3>
            <p id="payable-approvals-description" className="mt-2 text-sm text-muted-foreground">
              Com alçada, os responsáveis aprovam os lançamentos antes do pagamento. Sem alçada, os
              novos pagamentos seguem diretamente após a conclusão do rateio. Aprovações já
              iniciadas mantêm seu fluxo.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="use-payable-approvals">Utiliza Alçada de Aprovação</Label>
            <Select
              value={value.use_payable_approvals ? "yes" : "no"}
              disabled={disabled}
              onValueChange={(option) =>
                setDraft({ ...value, use_payable_approvals: option === "yes" })
              }
            >
              <SelectTrigger
                id="use-payable-approvals"
                aria-describedby="payable-approvals-description"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Sim</SelectItem>
                <SelectItem value="no">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-[1fr_200px] sm:items-center sm:gap-6 sm:p-5">
          <div>
            <h3 className="flex items-center gap-2 font-medium">
              <BellRing className="size-4 text-primary" />
              Contas a receber
            </h3>
            <p id="collection-rules-description" className="mt-2 text-sm text-muted-foreground">
              Ative para usar as réguas configuradas por empresa. Ao desativar, as cobranças e
              suspensões automáticas ficam pausadas. As regras e o histórico são preservados.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="use-collection-rules">Utiliza Régua de Cobrança</Label>
            <Select
              value={value.use_collection_rules ? "yes" : "no"}
              disabled={disabled}
              onValueChange={(option) =>
                setDraft({ ...value, use_collection_rules: option === "yes" })
              }
            >
              <SelectTrigger
                id="use-collection-rules"
                aria-describedby="collection-rules-description"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Sim</SelectItem>
                <SelectItem value="no">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {access.edit ? (
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={!changed || save.isPending}
              onClick={() => setDraft(undefined)}
            >
              Descartar alterações
            </Button>
            <Button disabled={!changed || save.isPending} onClick={() => save.mutate(value)}>
              {save.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Salvar configurações
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
