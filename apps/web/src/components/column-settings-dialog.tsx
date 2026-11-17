import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  canHideColumn,
  normalizeTablePreferences,
  tablePageSizes,
  type ColumnPolicy,
  type TablePreferences,
} from "@/lib/table-preferences";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  policy: ColumnPolicy;
  value: TablePreferences;
  onApply: (value: TablePreferences, pageSizeChanged: boolean) => void;
  onRestoreFocus: () => void;
};

function itemsFor(order: string[], policy: ColumnPolicy) {
  return [
    ...order.map((key) => ({ key, visible: true })),
    ...policy.columns
      .filter((column) => !order.includes(column.key))
      .map((column) => ({ key: column.key, visible: false })),
  ];
}

export function ColumnSettingsDialog({
  open,
  onOpenChange,
  policy,
  value,
  onApply,
  onRestoreFocus,
}: Props) {
  // The parent mounts one draft per opening. Data refetches cannot reset it.
  const [items, setItems] = useState(() => itemsFor(value.visibleOrder, policy));
  const [draftPageSize, setDraftPageSize] = useState(value.pageSize);
  const [pageSizeChanged, setPageSizeChanged] = useState(false);
  const selectedPageSize = pageSizeChanged ? draftPageSize : value.pageSize;
  const visible = items.filter((item) => item.visible).map((item) => item.key);
  const labelOf = (key: string) => policy.columns.find((c) => c.key === key)?.label ?? key;
  const locked = (key: string) => visible.includes(key) && !canHideColumn(visible, key, policy);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setItems(next);
  };

  const toggle = (idx: number) => {
    if (locked(items[idx].key)) return;
    const next = [...items];
    next[idx] = { ...next[idx], visible: !next[idx].visible };
    setItems(next);
  };

  const handleSave = () => {
    onApply(
      normalizeTablePreferences({ visibleOrder: visible, pageSize: selectedPageSize }, policy),
      pageSizeChanged,
    );
    onOpenChange(false);
  };

  const reset = () => {
    setItems(itemsFor(policy.defaults.visibleOrder, policy));
    setDraftPageSize(policy.defaults.pageSize);
    setPageSizeChanged(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Configurar listagem</DialogTitle>
          <DialogDescription className="text-xs">
            Escolha colunas e registros por página. Mantenha uma identificação visível; colunas
            obrigatórias permanecem selecionadas.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[40dvh] space-y-1 overflow-y-auto sm:max-h-[50dvh]">
          {items.map((item, idx) => (
            <div
              key={item.key}
              className="flex items-center gap-2 rounded border bg-card px-2 py-1.5"
            >
              <label className="flex min-h-11 flex-1 items-center gap-2 text-xs sm:min-h-8">
                <Checkbox
                  checked={item.visible}
                  disabled={locked(item.key)}
                  aria-label={`Exibir ${labelOf(item.key)}`}
                  aria-description={
                    locked(item.key)
                      ? "Coluna obrigatória ou última identificação visível"
                      : undefined
                  }
                  onCheckedChange={() => toggle(idx)}
                />
                <span>{labelOf(item.key)}</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 sm:h-8 sm:w-8"
                aria-label={`Mover ${labelOf(item.key)} para cima`}
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 sm:h-8 sm:w-8"
                aria-label={`Mover ${labelOf(item.key)} para baixo`}
                onClick={() => move(idx, 1)}
                disabled={idx === items.length - 1}
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="page-size" className="text-xs font-semibold">
            Registros por página
          </Label>
          <Select
            value={String(selectedPageSize)}
            onValueChange={(value) => {
              setDraftPageSize(Number(value) as TablePreferences["pageSize"]);
              setPageSizeChanged(true);
            }}
          >
            <SelectTrigger id="page-size" className="h-11 sm:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tablePageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} registros
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" onClick={reset}>
            Restaurar padrão
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="button" size="sm" className="h-11 sm:h-8" onClick={handleSave}>
              Aplicar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
