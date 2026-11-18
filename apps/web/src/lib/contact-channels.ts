import { z } from "zod";
import { unmask } from "./masks.ts";

export const CONTACT_CHANNEL_REQUIRED = "Informe pelo menos um e-mail ou telefone.";
export const contactEmailField = z.preprocess(
  (value) => value ?? "",
  z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .pipe(z.email("E-mail inválido").or(z.literal(""))),
);
export const contactPhoneField = z.preprocess(
  (value) => value ?? "",
  z
    .string()
    .trim()
    .max(40)
    .refine(
      (value) => !value || (unmask(value).length >= 10 && unmask(value).length <= 15),
      "Telefone inválido",
    ),
);
type ContactChannels = {
  email?: string | null;
  phone?: string | null;
  secondary_emails?: string[];
  secondary_phones?: string[];
};
export function hasContactChannel(values: ContactChannels): boolean {
  return [
    values.email,
    values.phone,
    ...(values.secondary_emails ?? []),
    ...(values.secondary_phones ?? []),
  ].some((value) => !!value?.trim());
}
export function requireContactChannel(values: ContactChannels, ctx: z.RefinementCtx) {
  if (!hasContactChannel(values)) {
    for (const path of ["email", "phone"])
      ctx.addIssue({ code: "custom", path: [path], message: CONTACT_CHANNEL_REQUIRED });
  }
}
export const contactChannelFieldsSchema = z.object({
  email: contactEmailField,
  phone: contactPhoneField,
});
export const contactPrimaryChannelsSchema =
  contactChannelFieldsSchema.superRefine(requireContactChannel);
