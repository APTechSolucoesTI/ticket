import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FolderTree, Loader2, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";

export type FinancialCategory = {
  id: string;
  code: string;
  name: string;
  direction: "inflow" | "outflow" | "both";
  description: string | null;
};
export type FinancialCostCenter = {
  id: string;
  code: string;
  name: string;
  description: string | null;
};
type Editor = {
  kind: "category" | "cost_center";
  id: string | null;
  code: string;
  name: string;
  direction: FinancialCategory["direction"];
  description: string;
};
const db = supabase as unknown as SupabaseClient;

export function FinancialDimensionsDialog({
  companyId,
  canEdit,
  onClose,
}: {
  companyId: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<Editor>();
  const query = useQuery({
    queryKey: ["financial-dimensions", companyId],
    queryFn: async () => {
      const [categories, centers] = await Promise.all([
        db
          .from("financial_categories")
          .select("id,code,name,direction,description")
          .eq("operating_company_id", companyId)
          .is("deleted_at", null)
          .order("code"),
        db
          .from("financial_cost_centers")
          .select("id,code,name,description")
          .eq("operating_company_id", companyId)
          .is("deleted_at", null)
          .order("code"),
      ]);
      if (categories.error) throw categories.error;
      if (centers.error) throw centers.error;
      return {
        categories: (categories.data ?? []) as FinancialCategory[],
        centers: (centers.data ?? []) as FinancialCostCenter[],
      };
    },
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["financial-dimensions", companyId] });
  const save = useMutation({
    mutationFn: async () => {
      if (!editor || editor.code.trim().length < 1 || editor.name.trim().length < 2)
        throw new Error("Informe código e nome válidos.");
      const result =
        editor.kind === "category"
          ? await db.rpc("save_financial_category", {
              p_id: editor.id,
              p_operating_company_id: companyId,
              p_code: editor.code,
              p_name: editor.name,
              p_direction: editor.direction,
              p_description: editor.description || null,
            })
          : await db.rpc("save_financial_cost_center", {
              p_id: editor.id,
              p_operating_company_id: companyId,
              p_code: editor.code,
              p_name: editor.name,
              p_description: editor.description || null,
            });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      toast.success("Cadastro financeiro salvo.");
      setEditor(undefined);
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "salvar o cadastro financeiro")),
  });
  const archive = useMutation({
    mutationFn: async ({ kind, id }: { kind: Editor["kind"]; id: string }) => {
      const { error } = await db.rpc("archive_financial_dimension", {
        p_dimension: kind,
        p_id: id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Cadastro financeiro arquivado.");
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "arquivar o cadastro financeiro")),
  });
  const newEditor = (kind: Editor["kind"]) =>
    setEditor({
      kind,
      id: null,
      code: "",
      name: "",
      direction: kind === "category" ? "outflow" : "both",
      description: "",
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderTree className="size-5" />
            Classificações financeiras
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Categorias e centros de custo da empresa operadora selecionada.
          </p>
        </DialogHeader>
        {editor ? (
          <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="dimension-code">Código</Label>
              <Input
                id="dimension-code"
                maxLength={30}
                autoFocus
                value={editor.code}
                onChange={(event) => setEditor({ ...editor, code: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="dimension-name">Nome</Label>
              <Input
                id="dimension-name"
                maxLength={150}
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              />
            </div>
            {editor.kind === "category" ? (
              <div className="sm:col-span-2">
                <Label>Natureza</Label>
                <Select
                  value={editor.direction}
                  onValueChange={(value) =>
                    setEditor({ ...editor, direction: value as Editor["direction"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inflow">Somente entradas</SelectItem>
                    <SelectItem value="outflow">Somente saídas</SelectItem>
                    <SelectItem value="both">Entradas e saídas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Label htmlFor="dimension-description">Descrição</Label>
              <Textarea
                id="dimension-description"
                maxLength={1000}
                value={editor.description}
                onChange={(event) => setEditor({ ...editor, description: event.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setEditor(undefined)}>
                Cancelar
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Salvar
              </Button>
            </div>
          </div>
        ) : query.isLoading ? (
          <LoadingState label="Carregando classificações..." />
        ) : query.isError ? (
          <ErrorState
            title="Classificações indisponíveis"
            description="Não foi possível consultar categorias e centros de custo."
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : (
          <Tabs defaultValue="categories">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="categories">Categorias</TabsTrigger>
              <TabsTrigger value="centers">Centros de custo</TabsTrigger>
            </TabsList>
            <TabsContent value="categories" className="space-y-3 pt-3">
              <DimensionHeader
                icon={Tags}
                title="Categorias financeiras"
                canEdit={canEdit}
                onAdd={() => newEditor("category")}
              />
              {query.data?.categories.length ? (
                query.data.categories.map((item) => (
                  <DimensionRow
                    key={item.id}
                    code={item.code}
                    name={item.name}
                    detail={
                      item.direction === "inflow"
                        ? "Entrada"
                        : item.direction === "outflow"
                          ? "Saída"
                          : "Entrada e saída"
                    }
                    onEdit={
                      canEdit
                        ? () =>
                            setEditor({
                              kind: "category",
                              id: item.id,
                              code: item.code,
                              name: item.name,
                              direction: item.direction,
                              description: item.description ?? "",
                            })
                        : undefined
                    }
                    onArchive={
                      canEdit ? () => archive.mutate({ kind: "category", id: item.id }) : undefined
                    }
                  />
                ))
              ) : (
                <EmptyState
                  title="Nenhuma categoria"
                  description="Cadastre receitas, despesas e outras naturezas do fluxo."
                />
              )}
            </TabsContent>
            <TabsContent value="centers" className="space-y-3 pt-3">
              <DimensionHeader
                icon={FolderTree}
                title="Centros de custo"
                canEdit={canEdit}
                onAdd={() => newEditor("cost_center")}
              />
              {query.data?.centers.length ? (
                query.data.centers.map((item) => (
                  <DimensionRow
                    key={item.id}
                    code={item.code}
                    name={item.name}
                    detail={item.description ?? "Sem descrição"}
                    onEdit={
                      canEdit
                        ? () =>
                            setEditor({
                              kind: "cost_center",
                              id: item.id,
                              code: item.code,
                              name: item.name,
                              direction: "both",
                              description: item.description ?? "",
                            })
                        : undefined
                    }
                    onArchive={
                      canEdit
                        ? () => archive.mutate({ kind: "cost_center", id: item.id })
                        : undefined
                    }
                  />
                ))
              ) : (
                <EmptyState
                  title="Nenhum centro de custo"
                  description="Cadastre as unidades responsáveis pelos resultados financeiros."
                />
              )}
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DimensionHeader({
  icon: Icon,
  title,
  canEdit,
  onAdd,
}: {
  icon: typeof Tags;
  title: string;
  canEdit: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-primary" />
        {title}
      </h3>
      {canEdit ? (
        <Button size="sm" className="gap-2" onClick={onAdd}>
          <Plus className="size-4" />
          Adicionar
        </Button>
      ) : null}
    </div>
  );
}
function DimensionRow({
  code,
  name,
  detail,
  onEdit,
  onArchive,
}: {
  code: string;
  name: string;
  detail: string;
  onEdit?: () => void;
  onArchive?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{code}</Badge>
          <p className="truncate font-medium">{name}</p>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {onEdit ? (
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" aria-label={`Editar ${name}`} onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Arquivar ${name}`} onClick={onArchive}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
