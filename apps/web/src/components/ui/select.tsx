"use client";

import * as React from "react";
import type * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReadOnly } from "@/lib/permission-ui";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

type Option = { value: string; label: React.ReactNode; text: string; disabled?: boolean };
type SelectContextValue = {
  value: string;
  options: Option[];
  open: boolean;
  disabled: boolean;
  setOpen(open: boolean): void;
  select(value: string): void;
  trigger: React.RefObject<HTMLButtonElement | null>;
};
const SelectContext = React.createContext<SelectContextValue | null>(null);
function useSelect() {
  const value = React.useContext(SelectContext);
  if (!value) throw new Error("Componente de seleção fora de Select.");
  return value;
}
function nodeText(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (React.isValidElement<{ children?: React.ReactNode }>(child))
        return nodeText(child.props.children);
      return "";
    })
    .join(" ")
    .trim();
}
function collectOptions(children: React.ReactNode): Option[] {
  return React.Children.toArray(children).flatMap((child): Option[] => {
    if (
      !React.isValidElement<{
        value?: string;
        children?: React.ReactNode;
        textValue?: string;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === SelectItem && child.props.value !== undefined)
      return [
        {
          value: child.props.value,
          label: child.props.children,
          text: child.props.textValue ?? nodeText(child.props.children),
          disabled: child.props.disabled,
        },
      ];
    return collectOptions(child.props.children);
  });
}
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

function Select({
  children,
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  name,
  required,
  form,
  autoComplete,
  dir,
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const readOnly = useReadOnly();
  const blocked = readOnly || disabled;
  const [localValue, setLocalValue] = React.useState(defaultValue);
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const value = controlledValue ?? localValue;
  const open = (controlledOpen ?? localOpen) && !blocked;
  const trigger = React.useRef<HTMLButtonElement>(null);
  const options = React.useMemo(() => collectOptions(children), [children]);
  const setOpen = (next: boolean) => {
    if (blocked && next) return;
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  };
  const select = (next: string) => {
    if (blocked || options.find((option) => option.value === next)?.disabled) return;
    if (controlledValue === undefined) setLocalValue(next);
    if (next !== value) onValueChange?.(next);
    setOpen(false);
  };
  React.useEffect(() => {
    if (controlledValue !== undefined) return;
    const element = trigger.current?.form;
    const reset = () => setLocalValue(defaultValue);
    element?.addEventListener("reset", reset);
    return () => element?.removeEventListener("reset", reset);
  }, [controlledValue, defaultValue, form]);
  return (
    <SelectContext.Provider
      value={{ value, options, open, disabled: blocked, setOpen, select, trigger }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        {children}
      </Popover>
      {name || required ? (
        <select
          aria-hidden
          tabIndex={-1}
          className="sr-only"
          name={name}
          form={form}
          autoComplete={autoComplete}
          required={required}
          disabled={blocked}
          value={value}
          onInvalid={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          onChange={(event) => select(event.target.value)}
          dir={dir}
        >
          <option value="" />
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.text}
            </option>
          ))}
        </select>
      ) : null}
    </SelectContext.Provider>
  );
}

const SelectValue = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { placeholder?: React.ReactNode }
>(({ placeholder, children, ...props }, ref) => {
  const { value, options } = useSelect();
  return (
    <span ref={ref} {...props}>
      {children ?? options.find((option) => option.value === value)?.label ?? placeholder}
    </span>
  );
});
SelectValue.displayName = "SelectValue";

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, onKeyDown, disabled, ...props }, forwardedRef) => {
  const select = useSelect();
  return (
    <PopoverTrigger asChild>
      <Button
        {...props}
        ref={(element) => {
          select.trigger.current = element;
          if (typeof forwardedRef === "function") forwardedRef(element);
          else if (forwardedRef) forwardedRef.current = element;
        }}
        type="button"
        variant="outline"
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={select.open}
        data-placeholder={!select.value ? "" : undefined}
        disabled={select.disabled || disabled}
        className={cn(
          "h-9 w-full min-w-0 justify-between bg-transparent px-3 py-2 font-normal data-[placeholder]:text-muted-foreground [&>span]:truncate",
          className,
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            select.setOpen(true);
          }
        }}
      >
        {children}
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
  );
});
SelectTrigger.displayName = "SelectTrigger";

type ContentProps = React.ComponentPropsWithoutRef<typeof PopoverContent> & {
  position?: "item-aligned" | "popper";
  searchPlaceholder?: string;
  emptyMessage?: string;
};
const SelectContent = React.forwardRef<HTMLDivElement, ContentProps>(
  (
    {
      className,
      children,
      position: _position,
      searchPlaceholder = "Buscar opções…",
      emptyMessage = "Nenhuma opção encontrada.",
      onOpenAutoFocus,
      ...props
    },
    ref,
  ) => {
    const select = useSelect();
    const input = React.useRef<HTMLInputElement>(null);
    return (
      <PopoverContent
        {...props}
        aria-label={props["aria-label"] ?? "Selecionar opção"}
        ref={ref}
        align={props.align ?? "start"}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden p-0",
          className,
        )}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (!event.defaultPrevented) {
            event.preventDefault();
            input.current?.focus();
          }
        }}
      >
        <Command
          label="Buscar opções"
          defaultValue={select.value}
          filter={(value, query, keywords) => {
            const text = normalize([value, ...(keywords ?? [])].join(" "));
            return normalize(query)
              .trim()
              .split(/\s+/)
              .every((word) => text.includes(word))
              ? 1
              : 0;
          }}
        >
          <CommandInput ref={input} placeholder={searchPlaceholder} aria-label="Buscar opções" />
          <CommandList
            label="Opções"
            className="max-h-52 overscroll-contain"
            style={{
              maxHeight: "min(13rem, calc(var(--radix-popover-content-available-height) - 6rem))",
            }}
          >
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>{children}</CommandGroup>
          </CommandList>
        </Command>
        <div className="flex justify-end border-t px-3 py-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => select.setOpen(false)}>
            Concluir
          </Button>
        </div>
      </PopoverContent>
    );
  },
);
SelectContent.displayName = "SelectContent";

const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, value, disabled, textValue, ...props }, ref) => {
  const select = useSelect();
  return (
    <CommandItem
      {...props}
      ref={ref}
      value={value}
      keywords={[textValue ?? nodeText(children)]}
      disabled={disabled}
      onSelect={() => select.select(value)}
      className={cn("cursor-pointer", className)}
    >
      <Check aria-hidden className={cn("size-4 shrink-0", select.value !== value && "invisible")} />
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </CommandItem>
  );
});
SelectItem.displayName = "SelectItem";
const SelectGroup = CommandGroup;
const SelectSeparator = CommandSeparator;
const SelectLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  ),
);
SelectLabel.displayName = "SelectLabel";

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
