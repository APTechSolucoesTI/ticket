export type ContractAllocation = {
  item_id: string;
  percentage: string | number;
  code?: string;
  name?: string;
};

// Integer hundredths of a percent: decimal input is parsed, never summed as floats.
export function percentageUnits(value: string | number): number | null {
  const text = String(value).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(units) && units > 0 && units <= 10000 ? units : null;
}

export function allocationTotal(items: ContractAllocation[]): number {
  return items.reduce((total, item) => total + (percentageUnits(item.percentage) ?? 0), 0);
}

export function allocationError(items: ContractAllocation[], label: string): string | null {
  if (!items.length) return `Informe ao menos um item no rateio de ${label}.`;
  if (items.some((item) => !item.item_id)) return `Selecione todos os itens de ${label}.`;
  if (new Set(items.map((item) => item.item_id)).size !== items.length)
    return `Não repita o mesmo item no rateio de ${label}.`;
  if (items.some((item) => percentageUnits(item.percentage) === null))
    return "O percentual deve ser maior que 0 e até 100, com no máximo 2 casas decimais.";
  const total = allocationTotal(items);
  return total === 10000
    ? null
    : `A soma dos percentuais de ${label} deve ser 100% (atual: ${formatPercentage(total / 100)}%).`;
}

export function formatPercentage(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(value));
}

export function allocationSummary(items: ContractAllocation[] | null | undefined): string {
  return (items ?? [])
    .map(
      (item) =>
        `${item.code ? `${item.code} · ` : ""}${item.name ?? "Item indisponível"} (${formatPercentage(item.percentage)}%)`,
    )
    .join(" / ");
}

export function legacyAllocation(
  items: ContractAllocation[] | null | undefined,
  itemId: string | null | undefined,
): ContractAllocation[] {
  return items?.length
    ? items.map((item) => ({ ...item }))
    : itemId
      ? [{ item_id: itemId, percentage: "100" }]
      : [];
}

export function allocationPayload(items: ContractAllocation[]) {
  return items.map((item) => ({
    item_id: item.item_id,
    percentage: String(item.percentage).trim().replace(",", "."),
  }));
}
