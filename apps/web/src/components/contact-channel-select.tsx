import { useState } from "react";
import { ChevronsUpDown, Plus, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { maskPhone } from "@/lib/masks";

export function ContactChannelSelect({
  kind,
  primary,
  secondary,
  onChange,
  disabled,
  errors,
}: {
  kind: "email" | "phone";
  primary: string;
  secondary: string[];
  onChange: (primary: string, secondary: string[]) => void;
  disabled: boolean;
  errors: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const email = kind === "email";
  const label = email ? "E-mail" : "Telefone";
  const values = [primary, ...secondary];
  const count = values.filter((value) => value.trim()).length;
  const field = email ? "secondary_emails" : "secondary_phones";
  const error =
    errors[kind] ||
    Object.entries(errors).find(([key]) => key === field || key.startsWith(`${field}.`))?.[1];
  const helpId = `contact-${kind}-help`;
  function change(next: string[]) {
    const [first = "", ...rest] = next;
    onChange(first, rest);
  }
  function remove(index: number) {
    change(values.filter((_, i) => i !== index));
  }
  return (
    <div className="space-y-2">
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={`contact-${kind}`}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-expanded={open}
            aria-invalid={!!error}
            aria-describedby={helpId}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">
              {count
                ? `${count} ${email ? (count === 1 ? "e-mail cadastrado" : "e-mails cadastrados") : count === 1 ? "telefone cadastrado" : "telefones cadastrados"}`
                : email
                  ? "Adicionar e-mails"
                  : "Adicionar telefones"}
            </span>
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <div className="max-h-64 space-y-3 overflow-y-auto p-3">
            {values.map((value, index) => {
              const id = `contact-${kind}-value-${index}`;
              const issue = errors[index === 0 ? kind : `${field}.${index - 1}`];
              return (
                <div key={index} className="space-y-1.5">
                  <Label htmlFor={id} className="text-xs">
                    {label} {index + 1}
                    {index === 0 && " · Principal"}
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id={id}
                      type={email ? "email" : "tel"}
                      autoComplete="off"
                      value={value}
                      aria-invalid={!!issue}
                      aria-describedby={issue ? `${id}-error` : undefined}
                      placeholder={email ? "nome@empresa.com.br" : "55 11 99999-9999"}
                      onChange={(event) =>
                        change(
                          values.map((v, i) =>
                            i === index
                              ? email
                                ? event.target.value
                                : maskPhone(event.target.value)
                              : v,
                          ),
                        )
                      }
                    />
                    {value || index > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remover ${label.toLowerCase()} ${index + 1}`}
                        onClick={() => remove(index)}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </div>
                  {issue && (
                    <p id={`${id}-error`} className="text-xs text-destructive">
                      {issue}
                    </p>
                  )}
                </div>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-0 text-primary"
              onClick={() => change([...values, ""])}
            >
              <Plus />
              {email ? "Adicionar e-mail" : "Adicionar telefone"}
            </Button>
          </div>
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            {count} cadastrado(s)
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Concluir
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {count > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md bg-muted/40 p-2">
          {values.map(
            (value, index) =>
              value.trim() && (
                <div
                  key={index}
                  className="flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Definir ${value} como ${label.toLowerCase()} principal`}
                    aria-pressed={index === 0}
                    title={index === 0 ? `${label} principal` : "Definir como principal"}
                    className="shrink-0 rounded p-0.5 text-primary focus-visible:outline focus-visible:outline-2"
                    onClick={() =>
                      change([value, ...values.filter((v, i) => i !== index && v.trim())])
                    }
                  >
                    <Star className={`size-3.5 ${index === 0 ? "fill-primary" : ""}`} />
                  </button>
                  <span className="truncate" title={value}>
                    {value}
                  </span>
                  {index === 0 && <span className="text-primary">· Principal</span>}
                  {!disabled && (
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline focus-visible:outline-2"
                      aria-label={`Remover ${label.toLowerCase()} ${value}`}
                      onClick={() => remove(index)}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ),
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p id={helpId} className="text-xs text-muted-foreground">
        {email ? "Cadastre ao menos um e-mail." : "Telefones são opcionais."} Use a estrela para
        definir o principal.
      </p>
    </div>
  );
}
