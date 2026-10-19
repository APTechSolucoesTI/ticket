const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export const compareOptionLabels = collator.compare;

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

// Equal scores keep matching options in their alphabetical display order.
export function filterOption(value: string, query: string, keywords?: string[]) {
  const text = normalize([value, ...(keywords ?? [])].join(" "));
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((word) => text.includes(word))
    ? 1
    : 0;
}
