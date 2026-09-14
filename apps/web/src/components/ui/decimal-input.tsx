import * as React from "react";
import { Input } from "@/components/ui/input";

type DecimalInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "onChange" | "inputMode"
> & {
  value: string | number | null | undefined;
  onValueChange: (value: string) => void;
  decimalScale: number;
  maxIntegerDigits: number;
  allowNegative?: boolean;
};

function canonicalParts(value: string | number | null | undefined, scale: number) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "number" ? String(value) : value.trim().replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  const [integer, fraction = ""] = Math.abs(number).toFixed(scale).split(".");
  return { negative: number < 0, integer, fraction };
}

function formatParts(parts: { negative: boolean; integer: string; fraction: string }) {
  const grouped = parts.integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${parts.negative ? "-" : ""}${grouped}${parts.fraction ? `,${parts.fraction}` : ""}`;
}

function parseTypedValue(
  input: string,
  decimalScale: number,
  maxIntegerDigits: number,
  allowNegative: boolean,
) {
  const negative = allowNegative && input.trimStart().startsWith("-");
  const cleaned = input.replace(/[^\d.,]/g, "");
  const separator = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  const integerSource = separator >= 0 ? cleaned.slice(0, separator) : cleaned;
  const fractionSource = separator >= 0 ? cleaned.slice(separator + 1) : "";
  const integer = (integerSource.replace(/\D/g, "").replace(/^0+(?=\d)/, "") || "0").slice(
    0,
    maxIntegerDigits,
  );
  const fraction = fractionSource.replace(/\D/g, "").slice(0, decimalScale);
  const hasSeparator = separator >= 0 && decimalScale > 0;
  return {
    text:
      formatParts({ negative, integer, fraction: hasSeparator ? fraction : "" }) +
      (hasSeparator && fraction.length === 0 ? "," : ""),
    canonical: `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`,
  };
}

export function DecimalInput({
  value,
  onValueChange,
  decimalScale,
  maxIntegerDigits,
  allowNegative = false,
  onFocus,
  onBlur,
  ...props
}: DecimalInputProps) {
  const [focused, setFocused] = React.useState(false);
  const [text, setText] = React.useState(() => {
    const parts = canonicalParts(value, decimalScale);
    return parts ? formatParts(parts) : "";
  });

  React.useEffect(() => {
    if (focused) return;
    const parts = canonicalParts(value, decimalScale);
    setText(parts ? formatParts(parts) : "");
  }, [decimalScale, focused, value]);

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        if (!event.target.value.trim()) {
          setText("");
          onValueChange("");
          return;
        }
        const parsed = parseTypedValue(
          event.target.value,
          decimalScale,
          maxIntegerDigits,
          allowNegative,
        );
        setText(parsed.text);
        onValueChange(parsed.canonical);
      }}
      onBlur={(event) => {
        setFocused(false);
        const parts = canonicalParts(value, decimalScale);
        setText(parts ? formatParts(parts) : "");
        onBlur?.(event);
      }}
    />
  );
}

export function CurrencyInput(props: Omit<DecimalInputProps, "decimalScale" | "maxIntegerDigits">) {
  return <DecimalInput {...props} decimalScale={4} maxIntegerDigits={9} />;
}

export function FinancialCurrencyInput(
  props: Omit<DecimalInputProps, "decimalScale" | "maxIntegerDigits">,
) {
  return <DecimalInput {...props} decimalScale={2} maxIntegerDigits={9} />;
}

export function QuantityInput(props: Omit<DecimalInputProps, "decimalScale" | "maxIntegerDigits">) {
  return <DecimalInput {...props} decimalScale={2} maxIntegerDigits={6} />;
}
