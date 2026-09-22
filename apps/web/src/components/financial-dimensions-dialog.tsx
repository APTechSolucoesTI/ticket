import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

type ClassificationType = "analytic" | "synthetic";
type FinancialDimensionBase = {
  id: string;
  operating_company_id: string;
  code: string;
  name: string;
  description: string | null;
  is_global: boolean;
  is_active: boolean;
  classification_type: ClassificationType;
};
export type FinancialCategory = FinancialDimensionBase & {
  direction: "inflow" | "outflow" | "both";
};
export type FinancialCostCenter = FinancialDimensionBase;
type Dimension = FinancialCategory | FinancialCostCenter;
type Editor = {
  kind: "category" | "cost_center";
  id: string | null;
  code: string;
  name: string;
  direction: FinancialCategory["direction"];
  description: string;
  isGlobal: boolean;
  isActive: boolean;
  classificationType: ClassificationType;
};
type Company = { id: string; legal_name: string; trade_name: string | null };

const db = supabase as unknown as SupabaseClient;
const CODE_PATTERN = /^\d{2}\.\d{2}\.\d{4}$/;

function maskCode(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join(".");
}

function codeLevel(code: string) {
  if (!CODE_PATTERN.test(code)) return Math.max(0, code.split(".").length - 1);
  const [, middle = "00", last = "0000"] = code.split(".");
  return last !== "0000" ? 2 : middle !== "00" ? 1 : 0;
}

function isDescendantCode(parentCode: string, childCode: string) {
  if (parentCode === childCode) return false;
  if (!CODE_PATTERN.test(parentCode) || !CODE_PATTERN.test(childCode)) {
    return childCode.startsWith(`${parentCode}.`);
  }

  const parent = parentCode.split(".");
  const child = childCode.split(".");
  const parentLevel = codeLevel(parentCode);
  const childLevel = codeLevel(childCode);
  if (childLevel <= parentLevel || parent[0] !== child[0]) return false;
  if (parentLevel === 0) return true;
  return parent[1] === child[1];
}

function suggestedChildCode(parentCode: string, items: Dimension[]) {
  const [first = "00", middle = "00"] = parentCode.split(".");
  const level = codeLevel(parentCode);
  if (level === 0) {
    const next =
      Math.max(
        0,
        ...items
          .filter((item) => item.code.startsWith(`${first}.`) && codeLevel(item.code) === 1)
          .map((item) => Number(item.code.split(".")[1])),
      ) + 1;
    return `${first}.${String(next).padStart(2, "0")}.0000`;
  }
  const next =
    Math.max(
      0,
      ...items
        .filter((item) => item.code.startsWith(`${first}.${middle}.`) && codeLevel(item.code) === 2)
        .map((item) => Number(item.code.split(".")[2])),
    ) + 1;
  return `${first}.${middle}.${String(next).padStart(4, "0")}`;
}

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
    queryClient.invalidateQueries({ queryKey: ["financial-dimensions", companyId] });
  const save = useMutation({
    mutationFn: async (value: Editor) => {
      if (!CODE_PATTERN.test(value.code) || value.name.trim().length < 2) {
        throw new Error("Informe o código no formato 99.99.9999 e um nome válido.");
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
        value.kind === "category"
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
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "arquivar o cadastro financeiro")),
  });
  const openNewEditor = (
    kind: Editor["kind"],
    classificationType: ClassificationType = "analytic",
    code = "",
  ) =>
    setEditor({
      kind,
      id: null,
      code,
      name: "",
      direction: kind === "category" ? "outflow" : "both",
      description: "",
      isGlobal: false,
      isActive: true,
      classificationType,
    });
  const openEditor = (kind: Editor["kind"], item: Dimension) =>
    setEditor({
      kind,
      id: item.id,
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
              onCancel={() => setEditor(undefined)}
              onSave={() => save.mutate(editor)}
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
            <Tabs defaultValue="categories">
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
                  onAdd={() => openNewEditor("category")}
                  onAddChild={(item) =>
                    openNewEditor(
                      "category",
                      codeLevel(item.code) === 0 ? "synthetic" : "analytic",
                      suggestedChildCode(item.code, query.data?.categories ?? []),
                    )
                  }
                  onEdit={(item) => openEditor("category", item)}
                  onToggleActive={(item) => toggleActive("category", item)}
                  onArchive={(item) => archive.mutate({ kind: "category", id: item.id })}
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
                  onAdd={() => openNewEditor("cost_center")}
                  onAddChild={(item) =>
                    openNewEditor(
                      "cost_center",
                      codeLevel(item.code) === 0 ? "synthetic" : "analytic",
                      suggestedChildCode(item.code, query.data?.centers ?? []),
                    )
                  }
                  onEdit={(item) => openEditor("cost_center", item)}
                  onToggleActive={(item) => toggleActive("cost_center", item)}
                  onArchive={(item) => archive.mutate({ kind: "cost_center", id: item.id })}
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
      </DialogContent>
    </Dialog>
  );
}

function DimensionEditor({
  editor,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  editor: Editor;
  saving: boolean;
  onChange(value: Editor): void;
  onCancel(): void;
  onSave(): void;
}) {
  const valid = CODE_PATTERN.test(editor.code) && editor.name.trim().length >= 2;
  return (
    <div className="my-5 grid gap-4 rounded-xl border bg-muted/20 p-5 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="dimension-code">Código *</Label>
        <Input
          id="dimension-code"
          autoFocus
          inputMode="numeric"
          placeholder="01.01.0001"
          value={editor.code}
          onChange={(event) => onChange({ ...editor, code: maskCode(event.target.value) })}
          aria-invalid={Boolean(editor.code) && !CODE_PATTERN.test(editor.code)}
        />
        <p className="text-xs text-muted-foreground">Formato obrigatório: 99.99.9999</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dimension-name">Nome *</Label>
        <Input
          id="dimension-name"
          maxLength={150}
          value={editor.name}
          onChange={(event) => onChange({ ...editor, name: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Tipo *</Label>
        <Select
          value={editor.classificationType}
          onValueChange={(value) =>
            onChange({ ...editor, classificationType: value as ClassificationType })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="analytic">Analítica</SelectItem>
            <SelectItem value="synthetic">Sintética</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {editor.kind === "category" ? (
        <div className="space-y-1.5">
          <Label>Natureza *</Label>
          <Select
            value={editor.direction}
            onValueChange={(value) =>
              onChange({ ...editor, direction: value as Editor["direction"] })
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
      <div className="space-y-1.5">
        <Label>Global *</Label>
        <Select
          value={editor.isGlobal ? "yes" : "no"}
          onValueChange={(value) => onChange({ ...editor, isGlobal: value === "yes" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Sim</SelectItem>
            <SelectItem value="no">Não</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Ativo *</Label>
        <Select
          value={editor.isActive ? "yes" : "no"}
          onValueChange={(value) => onChange({ ...editor, isActive: value === "yes" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Sim</SelectItem>
            <SelectItem value="no">Não</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="dimension-description">Descrição</Label>
        <Textarea
          id="dimension-description"
          maxLength={1000}
          value={editor.description}
          onChange={(event) => onChange({ ...editor, description: event.target.value })}
        />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={onSave} disabled={saving || !valid}>
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Salvar
        </Button>
      </div>
    </div>
  );
}

function DimensionList({
  kind,
  icon: Icon,
  title,
  items,
  companyNames,
  canEdit,
  saving,
  onAdd,
  onAddChild,
  onEdit,
  onToggleActive,
  onArchive,
}: {
  kind: Editor["kind"];
  icon: typeof Tags;
  title: string;
  items: Dimension[];
  companyNames: Map<string, string>;
  canEdit: boolean;
  saving: boolean;
  onAdd(): void;
  onAddChild(item: Dimension): void;
  onEdit(item: Dimension): void;
  onToggleActive(item: Dimension): void;
  onArchive(item: Dimension): void;
}) {
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const groups = items.filter((item) => item.classification_type === "synthetic");
  const collapsedGroups = groups.filter((item) => collapsed.has(item.id));
  const visible = items.filter((item) =>
    collapsedGroups.every(
      (group) =>
        group.operating_company_id !== item.operating_company_id ||
        !isDescendantCode(group.code, item.code),
    ),
  );
  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="space-y-3 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <Icon className="size-4 text-primary" />
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Sintéticas agrupam; apenas analíticas ativas recebem lançamentos.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {groups.length ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={!collapsed.size}
                onClick={() => setCollapsed(new Set())}
              >
                <ChevronDown className="mr-1.5 size-4" />
                Expandir todos
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={groups.every((item) => collapsed.has(item.id))}
                onClick={() => setCollapsed(new Set(groups.map((item) => item.id)))}
              >
                <ChevronRight className="mr-1.5 size-4" />
                Recolher todos
              </Button>
            </>
          ) : null}
          {canEdit ? (
            <Button size="sm" className="gap-2" onClick={onAdd}>
              <Plus className="size-4" />
              Adicionar
            </Button>
          ) : null}
        </div>
      </div>
      {visible.length ? (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <div className="min-w-[900px]">
            {visible.map((item) => {
              const level = codeLevel(item.code);
              const synthetic = item.classification_type === "synthetic";
              const companyName =
                companyNames.get(item.operating_company_id) ?? "Empresa operadora";
              return (
                <div
                  key={item.id}
                  className={cn(
                    "grid min-h-13 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2.5 last:border-b-0",
                    !item.is_active && "bg-muted/40 text-muted-foreground",
                  )}
                >
                  <div
                    className="flex min-w-0 items-center gap-2"
                    style={{ paddingLeft: level * 24 }}
                  >
                    {synthetic ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0"
                        aria-label={
                          collapsed.has(item.id) ? `Expandir ${item.name}` : `Recolher ${item.name}`
                        }
                        aria-expanded={!collapsed.has(item.id)}
                        onClick={() => toggleCollapsed(item.id)}
                      >
                        {collapsed.has(item.id) ? (
                          <ChevronRight className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </Button>
                    ) : (
                      <span className="w-6" />
                    )}
                    {synthetic ? (
                      <FolderTree className="size-4 shrink-0 text-amber-600" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-blue-600" />
                    )}
                    <span className="w-24 shrink-0 font-mono text-xs font-medium">{item.code}</span>
                    <span className={cn("truncate text-sm", synthetic && "font-semibold")}>
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="max-w-40 truncate font-normal">
                      {item.is_global ? "Todas as empresas" : companyName}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        synthetic
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-blue-200 bg-blue-50 text-blue-700",
                      )}
                    >
                      {synthetic ? "Sintética" : "Analítica"}
                    </Badge>
                    {item.is_global ? <Badge variant="secondary">Global</Badge> : null}
                    <Switch
                      checked={item.is_active}
                      disabled={!canEdit || saving}
                      aria-label={`${item.is_active ? "Desativar" : "Ativar"} ${item.name}`}
                      onCheckedChange={() => onToggleActive(item)}
                    />
                    <Badge
                      className={cn(
                        item.is_active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {item.is_active ? "Ativa" : "Inativa"}
                    </Badge>
                    {canEdit && synthetic ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Adicionar abaixo de ${item.name}`}
                        onClick={() => onAddChild(item)}
                      >
                        <Plus className="size-4" />
                      </Button>
                    ) : null}
                    {canEdit ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Editar ${item.name}`}
                          onClick={() => onEdit(item)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Arquivar ${item.name}`}
                          onClick={() => onArchive(item)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          title={kind === "category" ? "Nenhuma categoria" : "Nenhum centro de custo"}
          description="Crie a primeira classificação financeira desta estrutura."
        />
      )}
    </section>
  );
}
