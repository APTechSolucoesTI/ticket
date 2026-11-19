import { z } from "zod";
import { normalizePhone } from "./masks";

const identifier = z
  .string()
  .trim()
  .max(255)
  .transform((value) => {
    if (z.email().safeParse(value).success)
      return { field: "email" as const, value: value.toLowerCase() };
    if (/^\+?[0-9().\s-]+$/.test(value)) {
      const phone = normalizePhone(value);
      if (/^\d{10,15}$/.test(phone)) return { field: "phone" as const, value: phone };
    }
    return null;
  })
  .pipe(z.object({ field: z.enum(["email", "phone"]), value: z.string() }));

// Accept the legacy email payload during a rolling frontend update.
export const portalIdentifierInput = z
  .object({ identifier: z.string().optional(), email: z.string().optional() })
  .refine(({ identifier, email }) => (identifier === undefined) !== (email === undefined));

export function parsePortalIdentifier(input: z.infer<typeof portalIdentifierInput>) {
  return identifier.safeParse(input.identifier ?? input.email);
}
