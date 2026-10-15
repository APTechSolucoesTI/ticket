export type ClassificationType = "analytic" | "synthetic";
export type FinancialDimensionBase = {
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
export type Dimension = FinancialCategory | FinancialCostCenter;
export type Editor = {
  kind: "category" | "cost_center";
  id: string | null;
  code: string;
  name: string;
  direction: FinancialCategory["direction"] | "";
  parentId: string | null;
  description: string;
  isGlobal: boolean;
  isActive: boolean;
  classificationType: ClassificationType;
};
export type Company = { id: string; legal_name: string; trade_name: string | null };
export type Dependencies = {
  children: number;
  active_children: number;
  active_links: number;
  history_links: number;
};
export type PendingAction = {
  kind: Editor["kind"];
  item: Dimension;
  action: "archive" | "deactivate";
};

export const FULL_CODE_PATTERN = /^\d{2}\.\d{2}\.\d{4}$/;
export const HIERARCHICAL_CODE_PATTERN = /^(?:\d{2}|\d{2}\.\d{2}|\d{2}\.\d{2}\.\d{4})$/;

export function isValidCode(code: string, type: ClassificationType) {
  if (!HIERARCHICAL_CODE_PATTERN.test(code)) return false;
  return type === "analytic" ? FULL_CODE_PATTERN.test(code) : true;
}

export function maskCode(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join(".");
}

export function codeLevel(code: string) {
  if (!FULL_CODE_PATTERN.test(code)) return Math.max(0, code.split(".").length - 1);
  const [, middle = "00", last = "0000"] = code.split(".");
  return last !== "0000" ? 2 : middle !== "00" ? 1 : 0;
}

export function isDescendantCode(parentCode: string, childCode: string) {
  if (parentCode === childCode) return false;
  if (!FULL_CODE_PATTERN.test(parentCode) || !FULL_CODE_PATTERN.test(childCode)) {
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

export function suggestedChildCode(parentCode: string, items: Dimension[], compact = false) {
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
    const child = `${first}.${String(next).padStart(2, "0")}`;
    return compact ? child : `${child}.0000`;
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

export function suggestedRootCode(items: Dimension[]) {
  const next =
    Math.max(
      0,
      ...items
        .filter((item) => codeLevel(item.code) === 0)
        .map((item) => Number(item.code.split(".")[0])),
    ) + 1;
  return String(next).padStart(2, "0");
}
