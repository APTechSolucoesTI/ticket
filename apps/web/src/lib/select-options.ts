const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export const compareOptionLabels = collator.compare;

// Read cmdk's current rendered highlight, including mouse and keyboard navigation.
export function getHighlightedOption(list: HTMLElement | null): string | undefined {
  const item = list?.querySelector<HTMLElement>(
    '[cmdk-item][data-selected="true"]:not([data-disabled="true"])',
  );
  return item && !item.closest("[hidden]")
    ? (item.getAttribute("data-value") ?? undefined)
    : undefined;
}

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
