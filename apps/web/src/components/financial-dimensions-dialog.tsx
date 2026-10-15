import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FolderTree, Loader2, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, LoadingState } from "@/components/data-state";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { DimensionEditor } from "@/components/financial-dimension-editor";
import { DimensionList } from "@/components/financial-dimension-list";
import {
  isValidCode,
  codeLevel,
  suggestedChildCode,
  suggestedRootCode,
  type ClassificationType,
  type FinancialCategory,
  type FinancialCostCenter,
  type Company,
  type Editor,
  type Dimension,
  type Dependencies,
  type PendingAction,
} from "@/lib/financial-dimensions";
export type { FinancialCategory, FinancialCostCenter } from "@/lib/financial-dimensions";
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
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [tab, setTab] = useState("categories");
  const inspectedId =
    pendingAction?.kind === "category"
      ? pendingAction.item.id
      : editor?.kind === "category"
        ? editor.id
        : null;
  const dependencies = useQuery({
    queryKey: ["financial-category-dependencies", inspectedId],
    enabled: Boolean(canEdit && inspectedId),
    queryFn: async () => {
      const { data, error } = await db.rpc("get_financial_category_dependencies", {
        p_id: inspectedId!,
      });
      if (error) throw error;
      return data as Dependencies;
    },
  });
  const query = useQuery({
    queryKey: ["financial-dimensions", companyId],
    queryFn: async () => {
      const scope = `operating_company_id.eq.${companyId},is_global.eq.true`;
      const [categories, centers, companies] = await Promise.all([
        db
          .from("financial_categories")
          .select(
            "id,operating_company_id,code,name,direction,description,is_global,is_active,classification_type",
          )
          .or(scope)
          .is("deleted_at", null)
          .order("code"),
        db
          .from("financial_cost_centers")
          .select(
            "id,operating_company_id,code,name,description,is_global,is_active,classification_type",
          )
          .or(scope)
          .is("deleted_at", null)
          .order("code"),
        db.from("operating_companies").select("id,legal_name,trade_name").is("deleted_at", null),
      ]);
      if (categories.error) throw categories.error;
      if (centers.error) throw centers.error;
      if (companies.error) throw companies.error;
      return {
        categories: (categories.data ?? []) as FinancialCategory[],
        centers: (centers.data ?? []) as FinancialCostCenter[],
        companies: (companies.data ?? []) as Company[],
      };
    },
  });
  const companyNames = useMemo(
    () =>
      new Map(
        (query.data?.companies ?? []).map((company) => [
          company.id,
          company.trade_name || company.legal_name,
        ]),
      ),
    [query.data?.companies],
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["financial-dimensions"] }),
      queryClient.invalidateQueries({
        queryKey: ["financial-category-dependencies"],
        refetchType: "none",
      }),
      queryClient.invalidateQueries({ queryKey: ["contract-allocation-options"] }),
    ]);
  const save = useMutation({
    mutationFn: async (value: Editor) => {
      if (
        !isValidCode(value.code, value.classificationType) ||
        value.name.trim().length < 2 ||
        (value.kind === "category" && !value.direction)
      ) {
        throw new Error(
          value.kind === "category"
            ? "Use 99, 99.99 ou 99.99.9999 para categorias sintéticas e 99.99.9999 para analíticas."
            : "Use 99, 99.99 ou 99.99.9999 para centros sintéticos e 99.99.9999 para analíticos.",
        );
      }
      const common = {
        p_id: value.id,
        p_operating_company_id: companyId,
        p_code: value.code,
        p_name: value.name,
        p_description: value.description || null,
        p_is_global: value.isGlobal,
        p_is_active: value.isActive,
        p_classification_type: value.classificationType,
      };
      const result =
        value.kind === "category" && !value.id
          ? await db.rpc("create_financial_category", {
              p_operating_company_id: companyId,
              p_parent_id: value.parentId,
              p_name: value.name,
              p_direction: value.direction,
              p_description: value.description || null,
              p_is_global: value.isGlobal,
              p_is_active: value.isActive,
              p_classification_type: value.classificationType,
            })
          : value.kind === "category"
            ? await db.rpc("save_financial_category", {
                ...common,
                p_direction: value.direction,
              })
            : await db.rpc("save_financial_cost_center", common);
      if (result.error) throw result.error;
    },
    onSuccess: async (_, value) => {
      toast.success(value.id ? "Classificação atualizada." : "Classificação cadastrada.");
      setEditor(undefined);
      setPendingAction(undefined);
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
      toast.success("Classificação arquivada.");
      setPendingAction(undefined);
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "arquivar o cadastro financeiro")),
  });
  const openNewEditor = (
    kind: Editor["kind"],
    classificationType: ClassificationType = "analytic",
    code = "",
    parent?: Dimension,
  ) =>
    setEditor({
      kind,
      id: null,
      code,
      name: "",
      direction:
        parent && "direction" in parent ? parent.direction : kind === "category" ? "" : "both",
      parentId: parent?.id ?? null,
      description: "",
      isGlobal: parent?.is_global ?? false,
      isActive: true,
      classificationType,
    });
  const openEditor = (kind: Editor["kind"], item: Dimension) =>
    setEditor({
      kind,
      id: item.id,
      parentId:
        (query.data?.categories ?? []).find(
          (parent) =>
            parent.code === item.code.split(".").slice(0, -1).join(".") &&
            (parent.is_global || parent.operating_company_id === item.operating_company_id),
        )?.id ?? null,
      code: item.code,
      name: item.name,
      direction: "direction" in item ? item.direction : "both",
      description: item.description ?? "",
      isGlobal: item.is_global,
      isActive: item.is_active,
      classificationType: item.classification_type,
    });
  const toggleActive = (kind: Editor["kind"], item: Dimension) =>
    save.mutate({
      kind,
      id: item.id,
      parentId: null,
      code: item.code,
      name: item.name,
      direction: "direction" in item ? item.direction : "both",
      description: item.description ?? "",
      isGlobal: item.is_global,
      isActive: !item.is_active,
      classificationType: item.classification_type,
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <FolderTree className="size-5 text-primary" />
            Classificações financeiras
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Estruture categorias e centros de custo analíticos ou sintéticos por empresa.
          </p>
        </DialogHeader>
        <div className="px-6">
          {editor ? (
            <DimensionEditor
              editor={editor}
              saving={save.isPending}
              onChange={setEditor}
              items={
                editor.kind === "category"
                  ? (query.data?.categories ?? [])
                  : (query.data?.centers ?? [])
              }
              dependencies={dependencies.data}
              onCancel={() => setEditor(undefined)}
              onSave={() => {
                if (editor.id && !editor.isActive) {
                  const item = (
                    editor.kind === "category" ? query.data?.categories : query.data?.centers
                  )?.find((row) => row.id === editor.id);
                  if (item?.is_active) {
                    setPendingAction({ kind: editor.kind, item, action: "deactivate" });
                    return;
                  }
                }
                save.mutate(editor);
              }}
            />
          ) : query.isLoading ? (
            <LoadingState label="Carregando classificações..." />
          ) : query.isError ? (
            <ErrorState
              title="Classificações indisponíveis"
              description="Não foi possível consultar categorias e centros de custo."
              action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
            />
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="categories">Categorias</TabsTrigger>
                <TabsTrigger value="centers">Centros de custo</TabsTrigger>
              </TabsList>
              <TabsContent value="categories" className="pt-4">
                <DimensionList
                  kind="category"
                  icon={Tags}
                  title="Categorias financeiras"
                  items={query.data?.categories ?? []}
                  companyNames={companyNames}
                  canEdit={canEdit}
                  saving={save.isPending}
                  onAdd={() =>
                    openNewEditor(
                      "category",
                      "synthetic",
                      suggestedRootCode(query.data?.categories ?? []),
                    )
                  }
                  onAddChild={(item) =>
                    openNewEditor(
                      "category",
                      codeLevel(item.code) === 0 ? "synthetic" : "analytic",
                      suggestedChildCode(item.code, query.data?.categories ?? [], true),
                      item,
                    )
                  }
                  onEdit={(item) => openEditor("category", item)}
                  onToggleActive={(item) =>
                    item.is_active
                      ? setPendingAction({ kind: "category", item, action: "deactivate" })
                      : toggleActive("category", item)
                  }
                  onArchive={(item) =>
                    setPendingAction({ kind: "category", item, action: "archive" })
                  }
                />
              </TabsContent>
              <TabsContent value="centers" className="pt-4">
                <DimensionList
                  kind="cost_center"
                  icon={FolderTree}
                  title="Centros de custo"
                  items={query.data?.centers ?? []}
                  companyNames={companyNames}
                  canEdit={canEdit}
                  saving={save.isPending}
                  onAdd={() =>
                    openNewEditor(
                      "cost_center",
                      "synthetic",
                      suggestedRootCode(query.data?.centers ?? []),
                    )
                  }
                  onAddChild={(item) =>
                    openNewEditor(
                      "cost_center",
                      codeLevel(item.code) === 0 ? "synthetic" : "analytic",
                      suggestedChildCode(item.code, query.data?.centers ?? [], true),
                      item,
                    )
                  }
                  onEdit={(item) => openEditor("cost_center", item)}
                  onToggleActive={(item) =>
                    item.is_active
                      ? setPendingAction({ kind: "cost_center", item, action: "deactivate" })
                      : toggleActive("cost_center", item)
                  }
                  onArchive={(item) =>
                    setPendingAction({ kind: "cost_center", item, action: "archive" })
                  }
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
        <AlertDialog
          open={Boolean(pendingAction)}
          onOpenChange={(open) =>
            !open && !save.isPending && !archive.isPending && setPendingAction(undefined)
          }
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingAction?.action === "archive"
                  ? "Arquivar classificação"
                  : "Inativar classificação"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingAction?.item.code} · {pendingAction?.item.name}. A classificação deixará de
                estar disponível para novos lançamentos. O histórico será preservado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {pendingAction?.kind === "category" ? (
              dependencies.isPending ? (
                <LoadingState label="Verificando vínculos…" />
              ) : dependencies.isError ? (
                <ErrorState
                  title="Não foi possível verificar os vínculos"
                  description="Tente novamente antes de continuar."
                  action={{ label: "Tentar novamente", onClick: () => void dependencies.refetch() }}
                />
              ) : (
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
                  <p>
                    Subcategorias: {dependencies.data?.children ?? 0} · Vínculos ativos:{" "}
                    {dependencies.data?.active_links ?? 0} · Referências históricas:{" "}
                    {dependencies.data?.history_links ?? 0}
                  </p>
                  {((pendingAction.action === "archive"
                    ? dependencies.data?.children
                    : dependencies.data?.active_children) ?? 0) > 0 ||
                  (dependencies.data?.active_links ?? 0) > 0 ? (
                    <p role="alert">
                      Operação bloqueada. Reorganize as subcategorias e os vínculos ativos antes de
                      continuar.
                    </p>
                  ) : null}
                </div>
              )
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={save.isPending || archive.isPending}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={
                  save.isPending ||
                  archive.isPending ||
                  (pendingAction?.kind === "category" &&
                    (dependencies.isPending ||
                      dependencies.isError ||
                      ((pendingAction.action === "archive"
                        ? dependencies.data?.children
                        : dependencies.data?.active_children) ?? 0) > 0 ||
                      (dependencies.data?.active_links ?? 0) > 0))
                }
                onClick={(event) => {
                  event.preventDefault();
                  if (!pendingAction) return;
                  if (pendingAction.action === "archive")
                    archive.mutate({ kind: pendingAction.kind, id: pendingAction.item.id });
                  else if (editor?.id === pendingAction.item.id) save.mutate(editor);
                  else toggleActive(pendingAction.kind, pendingAction.item);
                }}
              >
                {save.isPending || archive.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {pendingAction?.action === "archive"
                  ? "Confirmar arquivamento"
                  : "Confirmar inativação"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
