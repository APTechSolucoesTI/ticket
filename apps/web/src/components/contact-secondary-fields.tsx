import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskPhone } from "@/lib/masks";

export function ContactSecondaryFields({
  kind,
  values,
  onChange,
  disabled,
  errors,
}: {
  kind: "email" | "phone";
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  errors: Record<string, string>;
}) {
  const email = kind === "email";
  const label = email ? "E-mail secundário" : "Telefone secundário";
  const field = email ? "secondary_emails" : "secondary_phones";
  return (
    <div className="space-y-2">
      {values.map((value, index) => {
        const id = `contact-${field}-${index}`;
        const error = errors[`${field}.${index}`];
        return (
          <div key={index} className="space-y-1">
            <Label htmlFor={id} className="text-xs text-muted-foreground">
              {label} {index + 1}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={id}
                type={email ? "email" : "tel"}
                value={value}
                disabled={disabled}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                placeholder={email ? "outro@empresa.com.br" : "55 11 99999-9999"}
                onChange={(event) =>
                  onChange(
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
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remover ${label.toLowerCase()} ${index + 1}`}
                  onClick={() => onChange(values.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            {error && (
              <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}
      {errors[field] && (
        <p role="alert" className="text-xs text-destructive">
          {errors[field]}
        </p>
      )}
      {!disabled && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-0 text-primary"
          onClick={() => onChange([...values, ""])}
        >
          <Plus />
          {email ? "Adicionar e-mail" : "Adicionar telefone"}
        </Button>
      )}
    </div>
  );
}
