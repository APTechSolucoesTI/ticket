import { z } from "zod";

export type Cnae = {
  code: string;
  description: string;
  is_primary: boolean;
};

const cnaeSchema = z.object({
  code: z.string().regex(/^\d{7}$/),
  description: z.string().trim().min(1).max(300),
  is_primary: z.boolean(),
});

export function normalizeCnaeCode(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.padStart(7, "0").slice(-7) : "";
}

export function formatCnaeCode(code: string) {
  const digits = normalizeCnaeCode(code);
  return digits.replace(/^(\d{2})(\d{2})(\d)(\d{2})$/, "$1.$2-$3-$4");
}

export function parseStoredCnaes(value: unknown): Cnae[] {
  const result = z.array(cnaeSchema).safeParse(value);
  return result.success ? result.data : [];
}

export function extractCnaesFromCnpjLookup(data: Record<string, unknown>): Cnae[] {
  const entries = new Map<string, Cnae>();
  const primaryCode = normalizeCnaeCode(data.cnae_fiscal);
  const primaryDescription = String(data.cnae_fiscal_descricao ?? "").trim();

  if (primaryCode && primaryDescription) {
    entries.set(primaryCode, {
      code: primaryCode,
      description: primaryDescription,
      is_primary: true,
    });
  }

  const secondary = Array.isArray(data.cnaes_secundarios) ? data.cnaes_secundarios : [];
  secondary.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const code = normalizeCnaeCode(record.codigo);
    const description = String(record.descricao ?? "").trim();
    if (!code || !description || code === primaryCode) return;
    entries.set(code, { code, description, is_primary: false });
  });

  return [...entries.values()].sort(
    (first, second) =>
      Number(second.is_primary) - Number(first.is_primary) || first.code.localeCompare(second.code),
  );
}
