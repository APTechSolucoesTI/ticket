import { useId, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type FilterOption = { value: string; label: string; keywords?: string[] };
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

// An empty selection means there is no restriction for this filter.
export function MultiSelectFilter({
  label,
  allLabel,
  options,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  allLabel: string;
  options: FilterOption[];
  value: string[];
  onChange(value: string[]): void;
  compact?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selection = value.length
    ? value.map((item) => options.find((option) => option.value === item)?.label ?? item).join(", ")
    : allLabel;
  const choices: FilterOption[] = [{ value: "__all__", label: allLabel }, ...options];
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className={compact ? "text-xs" : undefined}>
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-describedby={`${id}-selection`}
            aria-expanded={open}
            aria-haspopup="dialog"
            title={selection}
            className={cn("w-full min-w-0 justify-between font-normal", compact && "text-xs")}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <span className="min-w-0 truncate">
              {value.length > 1 ? `${value.length} opções selecionadas` : selection}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={`${label} - opções`}
          className={cn(
            "w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0",
            compact && "[&_[cmdk-item]]:text-xs",
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <Command
            label={`Buscar ${label.toLocaleLowerCase("pt-BR")}`}
            filter={(item, query, keywords) => {
              const text = normalize([item, ...(keywords ?? [])].join(" "));
              return normalize(query)
                .trim()
                .split(/\s+/)
                .every((word) => text.includes(word))
                ? 1
                : 0;
            }}
          >
            <CommandInput
              ref={input}
              placeholder="Buscar opções…"
              aria-label={`Buscar ${label.toLocaleLowerCase("pt-BR")}`}
            />
            <CommandList
              label={`Opções de ${label.toLocaleLowerCase("pt-BR")}`}
              aria-multiselectable
              className="max-h-52 overscroll-contain"
              style={{
                maxHeight: "min(13rem, calc(var(--radix-popover-content-available-height) - 6rem))",
              }}
            >
              <CommandEmpty>Nenhuma opção encontrada.</CommandEmpty>
              <CommandGroup>
                {choices.map((option) => {
                  const checked =
                    option.value === "__all__" ? !value.length : value.includes(option.value);
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label, ...(option.keywords ?? [])]}
                      aria-checked={checked}
                      onSelect={() =>
                        onChange(
                          option.value === "__all__"
                            ? []
                            : checked
                              ? value.filter((item) => item !== option.value)
                              : [...value, option.value],
                        )
                      }
                      className="cursor-pointer"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input",
                        )}
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1 break-words">{option.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          <div className="flex justify-end border-t px-3 py-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Concluir
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <span id={`${id}-selection`} className="sr-only" aria-live="polite">
        {selection}
      </span>
    </div>
  );
}
