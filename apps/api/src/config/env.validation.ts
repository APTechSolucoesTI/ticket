import { z } from 'zod';

// Validado uma vez no boot (ConfigModule.forRoot({ validate })) — falha rápido
// e com mensagem clara em vez de um `undefined` silencioso estourando três
// camadas depois dentro de um service.
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // Mesmo projeto Supabase do frontend — a API usa a service_role key (nunca
  // exposta ao browser) pra tudo que hoje o front fazia direto com segredo.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // Mesmo valor de GOTRUE_JWT_SECRET/PGRST_JWT_SECRET do Supabase self-hosted —
  // autenticação própria do APTicket (apps/web assina, apps/api só valida
  // localmente, sem chamar o GoTrue) usa esse segredo pra continuar
  // compatível com RLS/auth.uid(). Ver supabase-auth.guard.ts.
  JWT_SECRET: z.string().min(20),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // AES-256-GCM: chave de 32 bytes em hex (64 chars) usada pra criptografar
  // senha IMAP/SMTP e token da uazapi antes de gravar no Postgres.
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'precisa ser 32 bytes em hex (64 caracteres)'),

  SWAGGER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // Origem do frontend, pra CORS quando a API for acessada direto (fora do
  // proxy same-origin do apps/web) — ex.: dev local, ou debug via /docs.
  CORS_ORIGIN: z.string().default('http://localhost:8080'),

  // FQDN enviado no EHLO/HELO SMTP. Sem ele o hostname interno do container
  // pode fazer o Nodemailer anunciar [127.0.0.1], bloqueado pela HostGator.
  SMTP_CLIENT_NAME: z
    .string()
    .regex(
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
      'precisa ser um hostname público completo (FQDN)',
    )
    .default('apticket.aptechinfo.com.br'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}
