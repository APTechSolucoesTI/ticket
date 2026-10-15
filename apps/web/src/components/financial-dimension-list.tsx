import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { EmptyState } from "@/components/data-state";
import { cn } from "@/lib/utils";
import {
  FULL_CODE_PATTERN,
  isDescendantCode,
  codeLevel,
  type Editor,
  type Dimension,
} from "@/lib/financial-dimensions";
export function DimensionList({
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
  const [search, setSearch] = useState("");
  const [nature, setNature] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState("all");
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  const filtering = Boolean(
    search.trim() || nature !== "all" || type !== "all" || status !== "all" || scope !== "all",
  );
  const matches = items.filter(
    (item) =>
      normalize(`${item.code} ${item.name} ${item.description ?? ""}`).includes(
        normalize(search.trim()),
      ) &&
      (nature === "all" || ("direction" in item && item.direction === nature)) &&
      (type === "all" || item.classification_type === type) &&
      (status === "all" || item.is_active === (status === "active")) &&
      (scope === "all" || item.is_global === (scope === "global")),
  );
  const groups = items.filter(
    (item) => item.classification_type === "synthetic" && !FULL_CODE_PATTERN.test(item.code),
  );
  const collapsedGroups = groups.filter((item) => collapsed.has(item.id));
  const visible = filtering
    ? items.filter((item) =>
        matches.some(
          (match) =>
            match.id === item.id ||
            (item.classification_type === "synthetic" &&
              isDescendantCode(item.code, match.code) &&
              (item.is_global || item.operating_company_id === match.operating_company_id)),
        ),
      )
    : items.filter((item) =>
        collapsedGroups.every(
          (group) =>
            (!group.is_global && group.operating_company_id !== item.operating_company_id) ||
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
      <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            className="pl-9"
            aria-label={kind === "category" ? "Buscar categorias" : "Buscar centros de custo"}
            placeholder="Buscar por código, nome ou descrição"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div
          className={cn(
            "grid gap-3 sm:grid-cols-2",
            kind === "category" ? "lg:grid-cols-4" : "lg:grid-cols-3",
          )}
        >
          {kind === "category" ? (
            <div className="space-y-1">
              <Label htmlFor={`${kind}-nature-filter`}>Natureza</Label>
              <Select value={nature} onValueChange={setNature}>
                <SelectTrigger id={`${kind}-nature-filter`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as naturezas</SelectItem>
                  <SelectItem value="inflow">Somente entradas</SelectItem>
                  <SelectItem value="outflow">Somente saídas</SelectItem>
                  <SelectItem value="both">Entradas e saídas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor={`${kind}-type-filter`}>Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id={`${kind}-type-filter`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="analytic">Analítica</SelectItem>
                <SelectItem value="synthetic">Sintética</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${kind}-status-filter`}>Situação</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id={`${kind}-status-filter`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as situações</SelectItem>
                <SelectItem value="active">Ativas</SelectItem>
                <SelectItem value="inactive">Inativas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${kind}-scope-filter`}>Abrangência</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id={`${kind}-scope-filter`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as abrangências</SelectItem>
                <SelectItem value="global">Global</SelectItem>
                <SelectItem value="local">Empresa operadora</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            {matches.length} de {items.length} cadastros
            {filtering ? " · agrupamentos pai mantidos para contexto" : ""}
          </p>
          {filtering ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setNature("all");
                setType("all");
                setStatus("all");
                setScope("all");
              }}
            >
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </div>
      {visible.length ? (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <div className="min-w-[900px]">
            <div
              aria-hidden="true"
              className={cn(
                "grid gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
                canEdit ? "grid-cols-[7rem_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
              )}
            >
              {canEdit ? <span>Ações</span> : null}
              <span>Código e classificação</span>
              <span>Natureza · abrangência · situação</span>
            </div>
            {visible.map((item) => {
              const level = codeLevel(item.code);
              const synthetic = item.classification_type === "synthetic";
              const canHaveChildren = synthetic && !FULL_CODE_PATTERN.test(item.code);
              const companyName =
                companyNames.get(item.operating_company_id) ?? "Empresa operadora";
              return (
                <div
                  key={item.id}
                  className={cn(
                    "grid min-h-13 items-center gap-3 border-b px-3 py-2.5 last:border-b-0",
                    canEdit
                      ? "grid-cols-[7rem_minmax(0,1fr)_auto]"
                      : "grid-cols-[minmax(0,1fr)_auto]",
                    !item.is_active && "bg-muted/40 text-muted-foreground",
                  )}
                >
                  {canEdit ? (
                    <div
                      className="flex w-28 items-center"
                      role="group"
                      aria-label={`Ações de ${item.name}`}
                    >
                      {canHaveChildren ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Adicionar abaixo de ${item.name}`}
                          onClick={() => onAddChild(item)}
                        >
                          <Plus className="size-4" />
                        </Button>
                      ) : (
                        <span className="size-9 shrink-0" aria-hidden="true" />
                      )}
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
                    </div>
                  ) : null}
                  <div
                    className="flex min-w-0 items-center gap-2"
                    style={{ paddingLeft: level * 24 }}
                  >
                    {canHaveChildren ? (
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
                    <div className="min-w-0">
                      <span
                        title={item.name}
                        className={cn("block truncate text-sm", synthetic && "font-semibold")}
                      >
                        {item.name}
                      </span>
                      {item.description ? (
                        <p
                          title={item.description}
                          className="truncate text-[11px] text-muted-foreground"
                        >
                          {item.description}
                        </p>
                      ) : null}
                    </div>
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
                    {"direction" in item ? (
                      <Badge variant="outline" className="font-normal">
                        {item.direction === "inflow"
                          ? "Somente entradas"
                          : item.direction === "outflow"
                            ? "Somente saídas"
                            : "Entradas e saídas"}
                      </Badge>
                    ) : null}
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
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          title={
            filtering
              ? "Nenhum cadastro encontrado"
              : kind === "category"
                ? "Nenhuma categoria"
                : "Nenhum centro de custo"
          }
          description={
            filtering
              ? "Ajuste a busca ou limpe os filtros para consultar a estrutura."
              : "Crie a primeira classificação financeira desta estrutura."
          }
        />
      )}
    </section>
  );
}
