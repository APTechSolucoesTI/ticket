import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";

type Policy = {
  id: string;
  name: string;
  minimum_amount: number;
  maximum_amount: number | null;
  used: boolean;
  approverIds: string[];
};
type Approver = { id: string; name: string; email: string };

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function SupplierApprovalPoliciesDialog({
  companyId,
  onClose,
  onSaved,
}: {
  companyId: string;
  onClose(): void;
  onSaved(): void;
}) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<Policy | null | undefined>();
  const [archiveTarget, setArchiveTarget] = useState<Policy>();
  const [name, setName] = useState("");
  const [minimum, setMinimum] = useState("0");
  const [maximum, setMaximum] = useState("");
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [selectedApprover, setSelectedApprover] = useState("");

  const query = useQuery({
    queryKey: ["supplier-approval-policies", companyId],
    queryFn: async () => {
      const policiesResult = await db
        .from("supplier_approval_policies")
        .select("id,name,minimum_amount,maximum_amount")
        .eq("operating_company_id", companyId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("minimum_amount");
      if (policiesResult.error) throw policiesResult.error;
      const ids = (policiesResult.data ?? []).map((item) => item.id as string);
      if (!ids.length) return [] as Policy[];
      const [stepsResult, requestsResult] = await Promise.all([
        db
          .from("supplier_approval_policy_steps")
          .select("policy_id,step_order,approver_id")
          .in("policy_id", ids)
          .is("deleted_at", null)
          .order("step_order"),
        db.from("supplier_payable_approval_requests").select("policy_id").in("policy_id", ids),
      ]);
      if (stepsResult.error) throw stepsResult.error;
      if (requestsResult.error) throw requestsResult.error;
      const used = new Set((requestsResult.data ?? []).map((item) => item.policy_id as string));
      return (policiesResult.data ?? []).map((item) => ({
        id: item.id as string,
        name: item.name as string,
        minimum_amount: Number(item.minimum_amount),
        maximum_amount: item.maximum_amount === null ? null : Number(item.maximum_amount),
        used: used.has(item.id as string),
        approverIds: (stepsResult.data ?? [])
          .filter((step) => step.policy_id === item.id)
          .map((step) => step.approver_id as string),
      })) as Policy[];
    },
  });

  const approvers = useQuery({
    queryKey: ["supplier-approval-approvers", companyId],
    queryFn: async () => {
      const { data, error } = await db.rpc("list_supplier_approval_approvers", {
        p_operating_company_id: companyId,
      });
      if (error) throw error;
      return (data ?? []) as Approver[];
    },
  });

  useEffect(() => {
    if (editor === undefined) return;
    setName(editor?.name ?? "");
    setMinimum(String(editor?.minimum_amount ?? 0));
    setMaximum(editor?.maximum_amount === null || !editor ? "" : String(editor.maximum_amount));
    setApproverIds(editor?.approverIds ?? []);
    setSelectedApprover("");
  }, [editor]);

  const approversById = useMemo(
    () => new Map((approvers.data ?? []).map((item) => [item.id, item])),
    [approvers.data],
  );
  const available = (approvers.data ?? []).filter((item) => !approverIds.includes(item.id));
  const validRange =
    Number.isFinite(Number(minimum)) &&
    Number(minimum) >= 0 &&
    (!maximum || (Number.isFinite(Number(maximum)) && Number(maximum) >= Number(minimum)));

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Informe o nome da alçada.");
      if (!validRange) throw new Error("Informe uma faixa de valores válida.");
      if (!approverIds.length) throw new Error("Informe ao menos um aprovador.");
      const { error } = await db.rpc("save_supplier_approval_policy", {
        p_policy_id: editor?.id ?? null,
        p_operating_company_id: companyId,
        p_name: name.trim(),
        p_minimum_amount: Number(minimum),
        p_maximum_amount: maximum ? Number(maximum) : null,
        p_approver_ids: approverIds,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(editor ? "Alçada atualizada." : "Alçada cadastrada.");
      await queryClient.invalidateQueries({ queryKey: ["supplier-approval-policies", companyId] });
      setEditor(undefined);
      onSaved();
    },
    onError: (error) => toast.error(getUserFacingError(error, "salvar a alçada")),
  });

  const archive = useMutation({
    mutationFn: async (policyId: string) => {
      const { error } = await db.rpc("archive_supplier_approval_policy", {
        p_policy_id: policyId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Alçada arquivada.");
      setArchiveTarget(undefined);
      await queryClient.invalidateQueries({ queryKey: ["supplier-approval-policies", companyId] });
      onSaved();
    },
    onError: (error) => toast.error(getUserFacingError(error, "arquivar a alçada")),
  });

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= approverIds.length) return;
    setApproverIds((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              Alçadas de aprovação
            </DialogTitle>
          </DialogHeader>

          {editor !== undefined ? (
            <div className="space-y-5">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2"
                onClick={() => setEditor(undefined)}
              >
                <ArrowLeft className="mr-2 size-4" /> Voltar para as alçadas
              </Button>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="approval-policy-name">Nome da alçada</Label>
                  <Input
                    id="approval-policy-name"
                    value={name}
                    maxLength={150}
                    placeholder="Ex.: Despesas até R$ 1.000"
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="approval-minimum">Valor mínimo</Label>
                  <Input
                    id="approval-minimum"
                    type="number"
                    min="0"
                    step="0.01"
                    value={minimum}
                    onChange={(event) => setMinimum(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="approval-maximum">Valor máximo</Label>
                  <Input
                    id="approval-maximum"
                    type="number"
                    min="0"
                    step="0.01"
                    value={maximum}
                    placeholder="Sem limite"
                    onChange={(event) => setMaximum(event.target.value)}
                  />
                </div>
              </div>

              <section
                className="space-y-3 rounded-xl border p-4"
                aria-labelledby="approvers-title"
              >
                <div>
                  <h3 id="approvers-title" className="font-medium">
                    Fluxo sequencial
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Cada responsável decide somente depois da aprovação da etapa anterior.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select value={selectedApprover} onValueChange={setSelectedApprover}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecione um aprovador" />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} · {item.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={!selectedApprover}
                    onClick={() => {
                      setApproverIds((current) => [...current, selectedApprover]);
                      setSelectedApprover("");
                    }}
                  >
                    <Plus className="mr-2 size-4" /> Adicionar
                  </Button>
                </div>
                {approverIds.length ? (
                  <div className="space-y-2">
                    {approverIds.map((id, index) => {
                      const approver = approversById.get(id);
                      return (
                        <div
                          key={id}
                          className="flex items-center gap-2 rounded-lg border bg-muted/20 p-2"
                        >
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {approver?.name ?? "Aprovador"}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {approver?.email}
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => move(index, -1)}
                            disabled={index === 0}
                            aria-label="Mover para cima"
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => move(index, 1)}
                            disabled={index === approverIds.length - 1}
                            aria-label="Mover para baixo"
                          >
                            <ArrowDown className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setApproverIds((current) => current.filter((item) => item !== id))
                            }
                            aria-label="Remover aprovador"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Nenhum aprovador incluído.
                  </div>
                )}
              </section>
              {editor?.used ? (
                <p className="text-sm text-amber-700">
                  Esta alçada já foi utilizada. Para preservar o histórico, arquive-a e crie uma
                  nova.
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditor(undefined)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => save.mutate()}
                  disabled={
                    save.isPending ||
                    editor?.used ||
                    !name.trim() ||
                    !validRange ||
                    !approverIds.length
                  }
                >
                  {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Salvar alçada
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Faixas de autorização</p>
                  <p className="text-xs text-muted-foreground">
                    As faixas não podem se sobrepor e devem cobrir os valores utilizados.
                  </p>
                </div>
                <Button onClick={() => setEditor(null)}>
                  <Plus className="mr-2 size-4" /> Nova alçada
                </Button>
              </div>
              {query.isLoading || approvers.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Carregando alçadas
                </div>
              ) : query.isError || approvers.isError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
                  Não foi possível consultar as alçadas ou os aprovadores elegíveis.
                </div>
              ) : query.data?.length ? (
                <div className="space-y-2">
                  {query.data.map((policy) => (
                    <div
                      key={policy.id}
                      className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700">
                        <CheckCircle2 className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{policy.name}</p>
                          {policy.used ? <Badge variant="secondary">Em uso</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          De {money.format(policy.minimum_amount)} até{" "}
                          {policy.maximum_amount === null
                            ? "sem limite"
                            : money.format(policy.maximum_amount)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {policy.approverIds
                            .map((id) => approversById.get(id)?.name ?? "Responsável")
                            .join(" → ")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditor(policy)}>
                          {policy.used ? "Visualizar" : "Editar"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Arquivar ${policy.name}`}
                          onClick={() => setArchiveTarget(policy)}
                        >
                          <Archive className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-10 text-center">
                  <ShieldCheck className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-3 font-medium">Nenhuma alçada configurada</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cadastre uma faixa antes de enviar contas para aprovação.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={onClose}>
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar alçada?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela deixará de ser utilizada em novos lançamentos. O histórico anterior será
              preservado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={() => archiveTarget && archive.mutate(archiveTarget.id)}
            >
              {archive.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
