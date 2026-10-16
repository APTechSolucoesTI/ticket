import { useId, useRef, useState } from "react";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  payableAttachmentCountLimit,
  payableAttachmentError,
  payableAttachmentLimit,
  payableAttachmentTypes,
  type PayableAttachmentDraft,
} from "@/lib/payable-attachments";

export function PayableAttachmentEditor({
  value,
  onChange,
  installments,
  disabled = false,
}: {
  value: PayableAttachmentDraft[];
  onChange(value: PayableAttachmentDraft[]): void;
  installments?: Array<{ number: number; dueDate: string }>;
  disabled?: boolean;
}) {
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  function patch(key: string, change: Partial<PayableAttachmentDraft>) {
    onChange(value.map((item) => (item.id === key ? { ...item, ...change } : item)));
  }
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label="Anexos da conta a pagar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="size-4 text-primary" />
            Anexos <span className="font-normal text-muted-foreground">(opcional)</span>
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Até 20 arquivos, de até 10 MB cada. Informe o tipo de cada anexo.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || value.length >= payableAttachmentCountLimit}
          onClick={() => picker.current?.click()}
        >
          <Plus className="size-4" />
          Adicionar anexos
        </Button>
        <input
          ref={picker}
          id={`${id}-files`}
          aria-label="Selecionar arquivos para anexar"
          type="file"
          multiple
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length + value.length > payableAttachmentCountLimit) {
              setError("Inclua no máximo 20 anexos por lançamento.");
              return;
            }
            if (
              files.some(
                (file) =>
                  !file.size || file.size > payableAttachmentLimit || file.name.length > 255,
              )
            ) {
              setError("Escolha arquivos de 1 byte a 10 MB, com nomes de até 255 caracteres.");
              return;
            }
            setError("");
            onChange([
              ...value,
              ...files.map((file) => ({
                id: crypto.randomUUID(),
                file,
                type: "" as const,
                description: "",
                installment: "",
              })),
            ]);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {installments ? (
        <p className="text-xs text-muted-foreground">
          Escolha em qual parcela cada arquivo será incluído.
          {!installments.length ? " Calcule as parcelas para selecioná-las." : ""}
        </p>
      ) : null}
      {!value.length ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          Nenhum anexo selecionado.
        </p>
      ) : (
        value.map((item, index) => {
          const issue = payableAttachmentError(item, installments?.length);
          return (
            <div key={item.id} className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">{item.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(item.file.size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{" "}
                    KB
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover anexo ${item.file.name}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((row) => row.id !== item.id))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-type-${index}`}>Tipo do anexo {index + 1} *</Label>
                  <Select
                    value={item.type}
                    disabled={disabled}
                    onValueChange={(type) =>
                      patch(item.id, {
                        type: type as PayableAttachmentDraft["type"],
                        description: "",
                      })
                    }
                  >
                    <SelectTrigger id={`${id}-type-${index}`}>
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(payableAttachmentTypes).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {item.type === "outros" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-description-${index}`}>
                      Descrição do tipo {index + 1} *
                    </Label>
                    <Input
                      id={`${id}-description-${index}`}
                      value={item.description}
                      maxLength={200}
                      disabled={disabled}
                      placeholder="Ex.: Contrato de prestação de serviços"
                      onChange={(event) => patch(item.id, { description: event.target.value })}
                    />
                  </div>
                ) : null}
                {installments ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-installment-${index}`}>
                      Parcela do anexo {index + 1} *
                    </Label>
                    <Select
                      value={
                        installments.some((p) => String(p.number) === item.installment)
                          ? item.installment
                          : ""
                      }
                      disabled={disabled || !installments.length}
                      onValueChange={(installment) => patch(item.id, { installment })}
                    >
                      <SelectTrigger id={`${id}-installment-${index}`}>
                        <SelectValue placeholder="Selecione a parcela" />
                      </SelectTrigger>
                      <SelectContent>
                        {installments.map((p) => (
                          <SelectItem key={p.number} value={String(p.number)}>
                            Parcela {p.number}
                            {p.dueDate ? ` · ${p.dueDate.split("-").reverse().join("/")}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
              {issue ? (
                <p className="text-xs text-destructive" role="status">
                  {issue}
                </p>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
