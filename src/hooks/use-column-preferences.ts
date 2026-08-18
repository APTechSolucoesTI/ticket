import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

export type ColumnDef = { key: string; label: string };

function storageKey(userId: string | undefined, listKey: string) {
  return `cols:${userId ?? "anon"}:${listKey}`;
}

/**
 * Per-user persisted column visibility + order for a listing.
 * Returns the ordered list of visible column keys plus a setter.
 */
export function useColumnPreferences(listKey: string, all: ColumnDef[], defaults?: string[]) {
  const { user } = useAuth();
  const fallback = defaults ?? all.map((c) => c.key);
  const [order, setOrder] = useState<string[]>(fallback);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(user?.id, listKey));
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        // keep only keys that still exist
        const valid = parsed.filter((k) => all.some((c) => c.key === k));
        if (valid.length) {
          setOrder(valid);
          return;
        }
      }
      setOrder(fallback);
    } catch {
      setOrder(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, listKey]);

  const save = useCallback(
    (next: string[]) => {
      setOrder(next);
      try {
        localStorage.setItem(storageKey(user?.id, listKey), JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    [user?.id, listKey],
  );

  return { visibleOrder: order, setVisibleOrder: save, allColumns: all };
}
