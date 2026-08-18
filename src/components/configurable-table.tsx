import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings2, ArrowUp, ArrowDown, ChevronsUpDown, Filter, X } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColumnSettingsDialog } from "@/components/column-settings-dialog";
import { useColumnPreferences, type ColumnDef } from "@/hooks/use-column-preferences";

export type ListColumn<T> = ColumnDef & {
  className?: string;
  cell: (row: T) => ReactNode;
  /** Returns the raw value used for sorting and filtering. If omitted, falls back to `row[key]`. */
  accessor?: (row: T) => string | number | boolean | Date | null | undefined;
  disableSort?: boolean;
  disableFilter?: boolean;
};

type Props<T> = {
  listKey: string;
  columns: ListColumn<T>[];
  defaultColumns?: string[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  rowActions?: (row: T) => ReactNode;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

function defaultAccessor<T>(row: T, key: string): unknown {
  const v = (row as Record<string, unknown>)[key];
  return v;
}

function toComparable(v: unknown): string | number {
  if (v == null) return "";
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" || typeof v === "boolean") return Number(v);
  return String(v).toLowerCase();
}

export function ConfigurableTable<T>({
  listKey, columns, defaultColumns, rows, rowKey, rowClassName, rowActions,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const { visibleOrder, setVisibleOrder, allColumns } = useColumnPreferences(
    listKey,
    columns.map((c) => ({ key: c.key, label: c.label })),
    defaultColumns ?? columns.map((c) => c.key),
  );
  const colMap = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const getValue = (row: T, key: string) => {
    const c = colMap.get(key);
    return c?.accessor ? c.accessor(row) : defaultAccessor(row, key);
  };

  const processed = useMemo(() => {
    let out = rows;
    const active = Object.entries(filters).filter(([, v]) => v.trim());
    if (active.length) {
      out = out.filter((r) =>
        active.every(([k, q]) => String(getValue(r, k) ?? "").toLowerCase().includes(q.toLowerCase())),
      );
    }
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = toComparable(getValue(a, sort.key));
        const bv = toComparable(getValue(b, sort.key));
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, sort, colMap]);

  const cycleSort = (key: string) => {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  return (
    <>
      <div className="flex justify-end mb-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Settings2 className="h-4 w-4 mr-1" /> Colunas
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {visibleOrder.map((k) => {
              const c = colMap.get(k);
              const sortable = !!c && !c.disableSort;
              const filterable = !!c && !c.disableFilter;
              const isSorted = sort?.key === k;
              const hasFilter = !!filters[k]?.trim();
              return (
                <TableHead key={k} className={`text-primary font-semibold uppercase tracking-wide text-xs bg-primary/5 ${c?.className ?? ""}`}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!sortable}
                      onClick={() => sortable && cycleSort(k)}
                      className={`inline-flex items-center gap-1 text-left ${sortable ? "hover:text-foreground cursor-pointer" : "cursor-default"}`}
                    >
                      <span>{c?.label ?? k}</span>
                      {sortable && (
                        isSorted
                          ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                          : <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                    {filterable && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={`h-5 w-5 ${hasFilter ? "text-primary" : "opacity-60 hover:opacity-100"}`}
                          >
                            <Filter className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2" align="start">
                          <div className="flex items-center gap-1">
                            <Input
                              autoFocus
                              value={filters[k] ?? ""}
                              placeholder={`Filtrar ${c?.label ?? k}`}
                              onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}
                              className="h-8 text-xs"
                            />
                            {hasFilter && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setFilters((f) => { const n = { ...f }; delete n[k]; return n; })}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </TableHead>
              );
            })}
            {rowActions && <TableHead className="w-20" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {processed.map((row) => (
            <TableRow key={rowKey(row)} className={rowClassName?.(row)}>
              {visibleOrder.map((k) => {
                const c = colMap.get(k);
                return (
                  <TableCell key={k} className={c?.className}>
                    {c?.cell(row)}
                  </TableCell>
                );
              })}
              {rowActions && <TableCell className="text-right">{rowActions(row)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ColumnSettingsDialog
        open={open}
        onOpenChange={setOpen}
        allColumns={allColumns}
        value={visibleOrder}
        onSave={setVisibleOrder}
      />
    </>
  );
}
