import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listInterOperatingCompanies } from "@/lib/inter-binding.functions";
import {
  evaluateCollectionPolicy,
  getCollectionPolicy,
  saveCollectionPolicy,
  type CollectionStep,
} from "@/lib/collection-rules.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const defaultStep = (): CollectionStep => ({
  days_after_due: 1,
  channel: "email",
  subject: "Lembrete de pagamento",
  message_template:
    "Olá, identificamos que o título {{documento}} venceu em {{vencimento}}. Valor em aberto: {{valor}}.",
  enabled: true,
});

export function CollectionRulesDialog({ onClose }: { onClose(): void }) {
  const client = useQueryClient();
  const listCompanies = useServerFn(listInterOperatingCompanies);
  const getPolicy = useServerFn(getCollectionPolicy);
  const savePolicy = useServerFn(saveCollectionPolicy);
  const evaluate = useServerFn(evaluateCollectionPolicy);
  const [selected, setSelected] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [suspendAfterDays, setSuspendAfterDays] = useState<number | null>(30);
  const [steps, setSteps] = useState<CollectionStep[]>([defaultStep()]);

  const companies = useQuery({
    queryKey: ["collection-operating-companies"],
    queryFn: () => listCompanies(),
  });
  const company = companies.data?.find((item) => item.id === selected) ?? companies.data?.[0];
  const query = useQuery({
    queryKey: ["collection-policy", company?.id],
    queryFn: () => getPolicy({ data: { company: company!.id } }),
    enabled: !!company,
  });
  useEffect(() => {
    if (!query.data) return;
    setEnabled(query.data.enabled);
    setSuspendAfterDays(query.data.suspend_after_days ?? 30);
    setSteps(query.data.steps.length ? query.data.steps : [defaultStep()]);
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      savePolicy({ data: { company: company!.id, enabled, suspendAfterDays, steps } }),
    onSuccess: async () => {
      toast.success("Régua de cobrança salva");
      await client.invalidateQueries({ queryKey: ["collection-policy", company?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const process = useMutation({
    mutationFn: () => evaluate({ data: { company: company!.id } }),
    onSuccess: async (result) => {
      toast.success(`${result.actions} lembrete(s) e ${result.events} evento(s) gerados`);
      await client.invalidateQueries({ queryKey: ["collection-policy", company?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const busy = save.isPending || process.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="mr-6 flex items-center gap-2">
            <BellRing className="size-5" />
            Régua de cobrança
          </DialogTitle>
          <DialogDescription>
            Defina os lembretes e o limite para sinalizar suspensão por inadimplência.
          </DialogDescription>
        </DialogHeader>
        {companies.isPending ? (
          <LoadingState />
        ) : companies.isError ? (
          <ErrorState
            title="Empresas indisponíveis"
            description="Não foi possível consultar seu acesso financeiro."
          />
        ) : !company ? (
          <EmptyState
            title="Nenhuma empresa disponível"
            description="Solicite ao administrador o vínculo financeiro com a empresa operadora."
          />
        ) : query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            title="Régua indisponível"
            description={query.error.message}
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : (
          <div className="space-y-5">
            {(companies.data?.length ?? 0) > 1 && (
              <div className="space-y-1.5">
                <Label>Empresa operadora</Label>
                <Select value={company.id} onValueChange={setSelected} disabled={busy}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.data?.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.legal_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{company.legal_name}</p>
                <p className="text-xs text-muted-foreground">
                  Geração automática permanece desligada até a ativação abaixo.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="collection-enabled">Ativar régua</Label>
                <Switch id="collection-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Lembretes pendentes" value={query.data?.pending_actions ?? 0} />
              <Metric label="Falhas" value={query.data?.failed_actions ?? 0} danger />
              <Metric label="Suspensões sinalizadas" value={query.data?.pending_events ?? 0} />
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              Nesta etapa, o processamento cria uma fila auditável. Nenhuma mensagem é enviada e
              nenhum contrato é suspenso diretamente.
            </div>
            <div className="space-y-2">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <Label htmlFor="suspend-days">Sinalizar suspensão após</Label>
                  <p className="text-xs text-muted-foreground">
                    Dias corridos depois do vencimento.
                  </p>
                </div>
                <Input
                  id="suspend-days"
                  className="w-28"
                  type="number"
                  min={1}
                  max={365}
                  value={suspendAfterDays ?? ""}
                  onChange={(event) =>
                    setSuspendAfterDays(event.target.value ? Number(event.target.value) : null)
                  }
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Etapas de contato</h3>
                  <p className="text-xs text-muted-foreground">
                    Use valores negativos para avisar antes do vencimento.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={steps.length >= 10}
                  onClick={() => setSteps([...steps, defaultStep()])}
                >
                  <Plus className="size-4" />
                  Adicionar
                </Button>
              </div>
              {steps.map((step, index) => (
                <div
                  key={`${step.id ?? "new"}-${index}`}
                  className="space-y-3 rounded-xl border p-4"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">Etapa {index + 1}</Badge>
                    <Button
                      aria-label={`Remover etapa ${index + 1}`}
                      size="icon"
                      variant="ghost"
                      disabled={steps.length === 1}
                      onClick={() => setSteps(steps.filter((_, position) => position !== index))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Dias após o vencimento</Label>
                      <Input
                        type="number"
                        min={-30}
                        max={365}
                        value={step.days_after_due}
                        onChange={(event) =>
                          setSteps(
                            steps.map((item, position) =>
                              position === index
                                ? { ...item, days_after_due: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Canal</Label>
                      <Select
                        value={step.channel}
                        onValueChange={(value) =>
                          setSteps(
                            steps.map((item, position) =>
                              position === index
                                ? { ...item, channel: value as CollectionStep["channel"] }
                                : item,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">E-mail</SelectItem>
                          <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          <SelectItem value="sms">SMS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {step.channel === "email" && (
                    <div className="space-y-1.5">
                      <Label>Assunto</Label>
                      <Input
                        maxLength={180}
                        value={step.subject ?? ""}
                        onChange={(event) =>
                          setSteps(
                            steps.map((item, position) =>
                              position === index ? { ...item, subject: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Mensagem</Label>
                    <Textarea
                      rows={3}
                      maxLength={4000}
                      value={step.message_template}
                      onChange={(event) =>
                        setSteps(
                          steps.map((item, position) =>
                            position === index
                              ? { ...item, message_template: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Variáveis: {"{{documento}}, {{vencimento}}, {{valor}}, {{cliente}}"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />O evento de suspensão é desacoplado:
              o módulo de contratos deverá consumi-lo antes de alterar o atendimento.
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Fechar
          </Button>
          {company && query.data && (
            <>
              <Button
                variant="outline"
                onClick={() => process.mutate()}
                disabled={busy || !query.data.enabled}
              >
                {process.isPending && <Loader2 className="size-4 animate-spin" />}Processar agora
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={busy || steps.some((step) => !step.message_template.trim())}
              >
                {save.isPending && <Loader2 className="size-4 animate-spin" />}Salvar régua
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={danger && value ? "text-lg font-semibold text-red-600" : "text-lg font-semibold"}
      >
        {value}
      </p>
    </div>
  );
}
