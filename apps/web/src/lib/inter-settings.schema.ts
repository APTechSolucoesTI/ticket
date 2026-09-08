import { z } from "zod";

export const interSettingsSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    account: z
      .string()
      .trim()
      .regex(
        /^[1-9][0-9]{0,19}$/,
        "Informe a conta com dígito, somente números e sem zeros à esquerda.",
      ),
    clientId: z.string().trim().max(300).default(""),
    clientSecret: z.string().trim().max(1000).default(""),
    certificate: z.string().max(32768).default(""),
    privateKey: z.string().max(32768).default(""),
    activate: z.boolean().default(false),
    productionConfirmation: z.boolean().default(false),
    version: z.number().int().min(0),
  })
  .superRefine((data, ctx) => {
    if (!!data.certificate !== !!data.privateKey) {
      ctx.addIssue({
        code: "custom",
        path: ["certificate"],
        message: "Envie certificado e chave privada juntos.",
      });
    }
    if (data.clientId && !data.clientSecret) {
      ctx.addIssue({
        code: "custom",
        path: ["clientSecret"],
        message: "Ao alterar o Client ID, informe também o Client Secret.",
      });
    }
    if (data.version === 0) {
      for (const field of ["clientId", "clientSecret", "certificate", "privateKey"] as const) {
        if (!data[field])
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "Obrigatório na primeira configuração deste ambiente.",
          });
      }
    }
    if (data.activate && data.environment === "production" && !data.productionConfirmation) {
      ctx.addIssue({
        code: "custom",
        path: ["productionConfirmation"],
        message: "Confirme a seleção do ambiente oficial.",
      });
    }
  });

export type InterSettingsInput = z.input<typeof interSettingsSchema>;
export type InterSettingsMetadata = {
  environment: "sandbox" | "production";
  account: string;
  is_active: boolean;
  certificate_expires_at: string;
  certificate_fingerprint: string;
  version: number;
  updated_at: string;
};
