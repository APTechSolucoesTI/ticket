import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  FULL_CODE_PATTERN,
  isValidCode,
  maskCode,
  isDescendantCode,
  suggestedChildCode,
  suggestedRootCode,
  codeLevel,
  type Editor,
  type Dimension,
  type Dependencies,
  type ClassificationType,
} from "@/lib/financial-dimensions";
export function DimensionEditor({
  editor,
  saving,
  onChange,
  onCancel,
  onSave,
  items,
  dependencies,
}: {
  editor: Editor;
  saving: boolean;
  onChange(value: Editor): void;
  onCancel(): void;
  onSave(): void;
  items: Dimension[];
  dependencies?: Dependencies;
}) {
  const valid =
    isValidCode(editor.code, editor.classificationType) &&
    editor.name.trim().length >= 2 &&
    (editor.kind !== "category" || Boolean(editor.direction));
  const automatic = editor.kind === "category" && !editor.id;
  const identityLocked =
    editor.kind === "category" &&
    (dependencies?.active_links ?? 0) + (dependencies?.history_links ?? 0) > 0;
  const hierarchyLocked =
    identityLocked || (editor.kind === "category" && (dependencies?.children ?? 0) > 0);
  const parents = items.filter(
    (item) =>
      item.id !== editor.id &&
      item.is_active &&
      item.classification_type === "synthetic" &&
      !FULL_CODE_PATTERN.test(item.code) &&
      (!editor.id || !isDescendantCode(editor.code, item.code)),
  );
  const parent = parents.find((item) => item.id === editor.parentId);
  const codeHelp =
    editor.classificationType === "synthetic"
      ? "Níveis sintéticos: 99, 99.99 ou 99.99.9999; não recebem lançamentos."
      : "Nível analítico: 99.99.9999; recebe lançamentos.";
  return (
    <div className="my-5 grid gap-4 rounded-xl border bg-muted/20 p-5 sm:grid-cols-2">
      {editor.kind === "category" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="dimension-parent">Categoria pai</Label>
          <Select
            value={editor.parentId ?? "__root__"}
            disabled={saving || hierarchyLocked}
            onValueChange={(value) => {
              const selected = parents.find((item) => item.id === value);
              onChange({
                ...editor,
                parentId: selected?.id ?? null,
                code: selected
                  ? suggestedChildCode(selected.code, items, true)
                  : suggestedRootCode(items),
                direction: selected && "direction" in selected ? selected.direction : "",
                isGlobal: selected?.is_global ?? editor.isGlobal,
                classificationType:
                  !selected || codeLevel(selected.code) === 0
                    ? "synthetic"
                    : editor.classificationType,
              });
            }}
          >
            <SelectTrigger id="dimension-parent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__root__">Sem categoria pai — novo grupo</SelectItem>
              {parents.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            O novo cadastro herda a natureza e a abrangência do agrupamento escolhido.
          </p>
        </div>
      ) : null}
      {identityLocked || hierarchyLocked ? (
        <p className="rounded-lg border bg-background p-3 text-xs text-muted-foreground sm:col-span-2">
          Esta categoria possui subcategorias ou vínculos. Sua estrutura está protegida; a descrição
          pode ser atualizada.
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="dimension-code">Código *</Label>
        <Input
          id="dimension-code"
          autoFocus
          inputMode="numeric"
          readOnly={automatic || hierarchyLocked}
          placeholder="01.01.0001"
          value={editor.code}
          onChange={(event) => {
            const code = maskCode(event.target.value);
            const prefix = code.split(".").slice(0, -1).join(".");
            onChange({
              ...editor,
              code,
              parentId: parents.find((item) => item.code === prefix)?.id ?? null,
            });
          }}
          aria-invalid={
            Boolean(editor.code) && !isValidCode(editor.code, editor.classificationType)
          }
        />
        <p className="text-xs text-muted-foreground">{codeHelp}</p>
        {automatic ? (
          <p className="text-xs text-muted-foreground">
            Código sugerido. O número definitivo é reservado pelo sistema ao salvar.
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dimension-name">Nome *</Label>
        <Input
          id="dimension-name"
          maxLength={150}
          disabled={identityLocked || saving}
          value={editor.name}
          onChange={(event) => onChange({ ...editor, name: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Tipo *</Label>
        <Select
          value={editor.classificationType}
          disabled={saving || hierarchyLocked || (editor.kind === "category" && !editor.parentId)}
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
            disabled={
              saving ||
              hierarchyLocked ||
              Boolean(parent && "direction" in parent && parent.direction !== "both")
            }
            onValueChange={(value) =>
              onChange({ ...editor, direction: value as Editor["direction"] })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione a natureza" />
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
          disabled={saving || hierarchyLocked || Boolean(parent && !parent.is_global)}
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
