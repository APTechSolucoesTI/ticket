import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Settings2,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function PaginationControls({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        {first}–{last} de {total}
      </span>
      <div className="flex items-center gap-1" aria-label="Paginação da listagem">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[6.5rem] rounded-md bg-primary px-3 py-2 text-center font-semibold text-primary-foreground shadow-sm">
          Página {page} de {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Próxima página"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ConfigurableTable<T>({
  listKey,
  columns,
  defaultColumns,
  rows,
  rowKey,
  rowClassName,
  rowActions,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
        active.every(([k, q]) => normalizeSearch(getValue(r, k)).includes(normalizeSearch(q))),
      );
    }
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = toComparable(getValue(a, sort.key));
        const bv = toComparable(getValue(b, sort.key));
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return (
          String(av).localeCompare(String(bv), "pt-BR", {
            numeric: true,
            sensitivity: "base",
          }) * dir
        );
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

  const activeFilterCount = Object.values(filters).filter((value) => value.trim()).length;
  const pageCount = Math.max(1, Math.ceil(processed.length / pageSize));
  const paginatedRows = useMemo(
    () => processed.slice((page - 1) * pageSize, page * pageSize),
    [processed, page, pageSize],
  );

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    setPage(1);
  }, [filters, sort, pageSize]);

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <PaginationControls
          page={page}
          pageCount={pageCount}
          total={processed.length}
          pageSize={pageSize}
          onPageChange={setPage}
        />
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setFilters({})}>
              <X className="mr-1 h-4 w-4" /> Limpar filtros ({activeFilterCount})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Settings2 className="mr-1 h-4 w-4" /> Colunas
          </Button>
        </div>
      </div>
      <Table containerClassName="max-h-[calc(100dvh-16rem)] rounded-md border">
        <TableHeader>
          <TableRow>
            {rowActions && (
              <TableHead className="w-20 whitespace-nowrap bg-muted text-xs font-semibold uppercase tracking-wide text-primary">
                Ações
              </TableHead>
            )}
            {visibleOrder.map((k) => {
              const c = colMap.get(k);
              const sortable = !!c && !c.disableSort;
              const filterable = !!c && !c.disableFilter;
              const isSorted = sort?.key === k;
              const hasFilter = !!filters[k]?.trim();
              return (
                <TableHead
                  key={k}
                  className={`bg-muted text-xs font-semibold uppercase tracking-wide text-primary ${c?.className ?? ""}`}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!sortable}
                      onClick={() => sortable && cycleSort(k)}
                      className={`inline-flex items-center gap-1 text-left ${sortable ? "hover:text-foreground cursor-pointer" : "cursor-default"}`}
                    >
                      <span>{c?.label ?? k}</span>
                      {sortable &&
                        (isSorted ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" />
                        ))}
                    </button>
                    {filterable && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            aria-label={`Filtrar ${c?.label ?? k}`}
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
                                onClick={() =>
                                  setFilters((f) => {
                                    const n = { ...f };
                                    delete n[k];
                                    return n;
                                  })
                                }
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedRows.map((row) => (
            <TableRow key={rowKey(row)} className={rowClassName?.(row)}>
              {rowActions && (
                <TableCell className="whitespace-nowrap">
                  <div className="flex items-center gap-0.5">{rowActions(row)}</div>
                </TableCell>
              )}
              {visibleOrder.map((k) => {
                const c = colMap.get(k);
                return (
                  <TableCell key={k} className={c?.className}>
                    {c?.cell(row)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
          {processed.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={visibleOrder.length + (rowActions ? 1 : 0)}
                className="h-24 text-center text-muted-foreground"
              >
                Nenhum registro corresponde aos filtros informados.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="mt-2 flex justify-end">
        <PaginationControls
          page={page}
          pageCount={pageCount}
          total={processed.length}
          pageSize={pageSize}
          onPageChange={setPage}
        />
      </div>
      <ColumnSettingsDialog
        open={open}
        onOpenChange={setOpen}
        allColumns={allColumns}
        value={visibleOrder}
        onSave={setVisibleOrder}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
      />
    </>
  );
}
