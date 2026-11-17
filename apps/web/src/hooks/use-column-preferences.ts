import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  columnPolicy,
  normalizeTablePreferences,
  readTablePreferences,
  readSavedTablePageSize,
  tablePreferenceKey,
  writeTablePreferences,
  type ColumnDef,
  type TablePreferences,
} from "@/lib/table-preferences";

export type { ColumnDef } from "@/lib/table-preferences";

export function useSavedTablePageSize(listKey: string) {
  const { user } = useAuth();
  return readSavedTablePageSize(tablePreferenceKey(user, listKey));
}

/** Validated preferences scoped to the current tenant, user and listing. */
export function useColumnPreferences(listKey: string, all: ColumnDef[], defaults?: string[]) {
  const { user } = useAuth();
  const scope = tablePreferenceKey(user, listKey);
  const legacyKey = `cols:${user?.id ?? "anon"}:${listKey}`;
  // Inline column arrays may change identity on every refresh. Only semantic
  // descriptors should invalidate the policy or reload stored state.
  const definition = JSON.stringify([all, defaults]);
  const policy = useMemo(() => {
    // This JSON is the typed, serializable descriptor above, not external data.
    const [columns, initial] = JSON.parse(definition) as [ColumnDef[], string[] | null];
    return columnPolicy(columns, initial ?? undefined);
  }, [definition]);
  type Snapshot = { scope: string; value: TablePreferences };
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const live = useRef<Snapshot | null>(null);
  useEffect(() => {
    const next = { scope, value: readTablePreferences(scope, legacyKey, policy) };
    live.current = next;
    setSnapshot(next);
  }, [scope, legacyKey, policy]);
  const preferences = normalizeTablePreferences(
    snapshot?.scope === scope ? snapshot.value : policy.defaults,
    policy,
  );
  const save = useCallback(
    (patch: Partial<TablePreferences>) => {
      const current =
        live.current?.scope === scope
          ? live.current.value
          : readTablePreferences(scope, legacyKey, policy);
      const value = normalizeTablePreferences({ ...current, ...patch }, policy);
      const next = { scope, value };
      live.current = next;
      writeTablePreferences(scope, value);
      setSnapshot(next);
    },
    [scope, legacyKey, policy],
  );
  return {
    ...preferences,
    preferences,
    policy,
    allColumns: policy.columns,
    defaults: policy.defaults,
    applyPreferences: save,
    setVisibleOrder: useCallback((visibleOrder: string[]) => save({ visibleOrder }), [save]),
    setPageSize: useCallback(
      (pageSize: number) => save({ pageSize: pageSize as TablePreferences["pageSize"] }),
      [save],
    ),
  };
}
