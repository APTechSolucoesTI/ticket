import { useState } from "react";
import { Check, ChevronsUpDown, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function ContactCompanySelect({
  companies,
  value,
  onChange,
  disabled,
  loading,
  error,
  onRetry,
  invalid,
}: {
  companies: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  invalid: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="contact-companies"
            type="button"
            variant="outline"
            disabled={disabled || loading}
            aria-expanded={open}
            aria-invalid={invalid}
            aria-describedby="contact-company-help"
            className="w-full justify-between font-normal"
          >
            <span className="truncate">
              {loading
                ? "Carregando clientes…"
                : value.length
                  ? `${value.length} cliente${value.length > 1 ? "s" : ""} selecionado${value.length > 1 ? "s" : ""}`
                  : "Selecionar clientes"}
            </span>
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandInput placeholder="Buscar cliente pelo nome…" aria-label="Buscar cliente" />
            <CommandList className="max-h-52">
              <CommandEmpty>
                {error ? "Não foi possível carregar os clientes." : "Nenhum cliente encontrado."}
              </CommandEmpty>
              <CommandGroup>
                {companies.map((company) => (
                  <CommandItem
                    key={company.id}
                    value={`${company.name} ${company.id}`}
                    onSelect={() =>
                      onChange(
                        value.includes(company.id)
                          ? value.filter((id) => id !== company.id)
                          : [...value, company.id],
                      )
                    }
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded border ${value.includes(company.id) ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}
                    >
                      {value.includes(company.id) && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1 break-words">{company.name}</span>
                    {value[0] === company.id && (
                      <span className="text-xs text-primary">Principal</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            {value.length} selecionado(s)
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Concluir
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {error && (
        <div role="alert" className="text-xs text-destructive">
          Não foi possível carregar os clientes.{" "}
          <button type="button" className="underline" onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      )}
      {value.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md bg-muted/40 p-2">
          {value.map((id, index) => {
            const name = companies.find((c) => c.id === id)?.name ?? "Cliente vinculado";
            return (
              <div
                key={id}
                className="flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
              >
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Definir ${name} como cliente principal`}
                  aria-pressed={index === 0}
                  title={index === 0 ? "Cliente principal" : "Definir como principal"}
                  className="shrink-0 rounded p-0.5 text-primary focus-visible:outline focus-visible:outline-2"
                  onClick={() => onChange([id, ...value.filter((v) => v !== id)])}
                >
                  <Star className={`size-3.5 ${index === 0 ? "fill-primary" : ""}`} />
                </button>
                <span className="truncate">{name}</span>
                {index === 0 && <span className="text-primary">· Principal</span>}
                {!disabled && (
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline focus-visible:outline-2"
                    aria-label={`Remover cliente ${name}`}
                    onClick={() => onChange(value.filter((v) => v !== id))}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p id="contact-company-help" className="text-xs text-muted-foreground">
        Selecione um ou mais clientes. Use a estrela para definir o principal.
      </p>
    </div>
  );
}
