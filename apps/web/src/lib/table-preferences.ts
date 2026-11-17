import { z } from "zod";

export type ColumnDef = { key: string; label: string; identifier?: boolean; required?: boolean };
export const tablePageSizes = [10, 20, 30, 50, 100] as const;
export type TablePageSize = (typeof tablePageSizes)[number];
export type TablePreferences = { visibleOrder: string[]; pageSize: TablePageSize };
export type ColumnPolicy = {
  columns: ColumnDef[];
  identifiers: string[];
  required: string[];
  defaults: TablePreferences;
};
const orderSchema = z.array(z.string()).max(200);
const pageSizeSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(30),
  z.literal(50),
  z.literal(100),
]);
const recordSchema = z.object({
  version: z.literal(1),
  visibleOrder: z.unknown(),
  pageSize: z.unknown(),
});

export function normalizeTablePreferences(
  value: { visibleOrder?: unknown; pageSize?: unknown },
  policy: ColumnPolicy,
): TablePreferences {
  const parsed = orderSchema.safeParse(value.visibleOrder);
  const known = new Set(policy.columns.map((column) => column.key));
  let order = Array.from(
    new Set(
      (parsed.success ? parsed.data : policy.defaults.visibleOrder).filter((key) => known.has(key)),
    ),
  );
  if (parsed.success && parsed.data.length > 0 && order.length === 0)
    order = [...policy.defaults.visibleOrder];
  if (!order.some((key) => policy.identifiers.includes(key)) && policy.identifiers[0])
    order.unshift(policy.identifiers[0]);
  for (const key of policy.required) if (!order.includes(key)) order.push(key);
  const size = pageSizeSchema.safeParse(value.pageSize);
  return { visibleOrder: order, pageSize: size.success ? size.data : 10 };
}

export function columnPolicy(columns: ColumnDef[], defaults?: string[]): ColumnPolicy {
  const unique = Array.from(new Map(columns.map((column) => [column.key, column])).values());
  const identifiers = unique.filter((column) => column.identifier).map((column) => column.key);
  if (identifiers.length === 0 && unique[0]) identifiers.push(unique[0].key);
  const policy: ColumnPolicy = {
    columns: unique.map((column) => ({ ...column, identifier: identifiers.includes(column.key) })),
    identifiers,
    required: unique.filter((column) => column.required).map((column) => column.key),
    defaults: { visibleOrder: [], pageSize: 10 },
  };
  policy.defaults = normalizeTablePreferences(
    { visibleOrder: defaults ?? unique.map((column) => column.key), pageSize: 10 },
    policy,
  );
  return policy;
}

export function canHideColumn(order: string[], key: string, policy: ColumnPolicy) {
  return (
    !policy.required.includes(key) &&
    (!policy.identifiers.includes(key) ||
      order.some((other) => other !== key && policy.identifiers.includes(other)))
  );
}

export function tablePreferenceKey(
  identity: { id?: string; tenantId?: string } | null,
  listKey: string,
) {
  return `table:v1:${encodeURIComponent(identity?.tenantId ?? "anon")}:${encodeURIComponent(identity?.id ?? "anon")}:${encodeURIComponent(listKey)}`;
}

function readStorage(key: string): { present: boolean; value: unknown } {
  try {
    if (typeof window === "undefined") return { present: false, value: null };
    const raw = window.localStorage.getItem(key);
    return { present: raw !== null, value: raw === null ? null : JSON.parse(raw) };
  } catch {
    return { present: true, value: null };
  }
}

export function readTablePreferences(
  key: string,
  legacyKey: string,
  policy: ColumnPolicy,
): TablePreferences {
  const stored = readStorage(key);
  if (stored.present) {
    const parsed = recordSchema.safeParse(stored.value);
    return parsed.success ? normalizeTablePreferences(parsed.data, policy) : policy.defaults;
  }
  const legacy = readStorage(legacyKey);
  if (!legacy.present || !orderSchema.safeParse(legacy.value).success) return policy.defaults;
  // The old key had no tenant. Bind its import to the first scope that claims
  // it; retaining the old array also permits reverting the UI without data loss.
  const bindingKey = `${legacyKey}:migrated`;
  const binding = readStorage(bindingKey);
  if (binding.present && binding.value !== key) return policy.defaults;
  if (!binding.present && !writeStorage(bindingKey, key)) return policy.defaults;
  const migrated = normalizeTablePreferences({ visibleOrder: legacy.value, pageSize: 10 }, policy);
  return writeTablePreferences(key, migrated) ? migrated : policy.defaults;
}

export function readSavedTablePageSize(key: string): TablePageSize {
  const parsed = recordSchema.safeParse(readStorage(key).value);
  if (!parsed.success) return 10;
  const size = pageSizeSchema.safeParse(parsed.data.pageSize);
  return size.success ? size.data : 10;
}

export function writeTablePreferences(key: string, value: TablePreferences) {
  return writeStorage(key, { version: 1, ...value });
}

function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    /* Keep applied preferences in memory when browser storage is unavailable. */
    return false;
  }
}
