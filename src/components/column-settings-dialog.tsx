import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ColumnDef } from "@/hooks/use-column-preferences";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  allColumns: ColumnDef[];
  value: string[];
  onSave: (next: string[]) => void;
};

export function ColumnSettingsDialog({ open, onOpenChange, allColumns, value, onSave }: Props) {
  // Merged list: visible (in order) first, then hidden
  const [items, setItems] = useState<{ key: string; visible: boolean }[]>([]);

  useEffect(() => {
    if (!open) return;
    const visible = value.map((k) => ({ key: k, visible: true }));
    const hidden = allColumns
      .filter((c) => !value.includes(c.key))
      .map((c) => ({ key: c.key, visible: false }));
    setItems([...visible, ...hidden]);
  }, [open, value, allColumns]);

  const labelOf = (key: string) => allColumns.find((c) => c.key === key)?.label ?? key;

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setItems(next);
  };

  const toggle = (idx: number) => {
    const next = [...items];
    next[idx] = { ...next[idx], visible: !next[idx].visible };
    setItems(next);
  };

  const handleSave = () => {
    onSave(items.filter((i) => i.visible).map((i) => i.key));
    onOpenChange(false);
  };

  const reset = () => {
    setItems(allColumns.map((c) => ({ key: c.key, visible: true })));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Configurar colunas</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {items.map((item, idx) => (
            <div key={item.key} className="flex items-center gap-2 rounded border bg-card px-2 py-1.5">
              <Checkbox checked={item.visible} onCheckedChange={() => toggle(idx)} />
              <span className="flex-1 text-xs">{labelOf(item.key)}</span>
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => move(idx, -1)} disabled={idx === 0}>
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => move(idx, 1)} disabled={idx === items.length - 1}>
                <ArrowDown className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={reset}>Restaurar padrão</Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" size="sm" onClick={handleSave}>Aplicar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
