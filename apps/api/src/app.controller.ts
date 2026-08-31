import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './auth/public.decorator';

// Templates de e-mail do GoTrue (Supabase Auth self-hosted) em pt-BR. Esse
// Supabase é compartilhado com outro sistema, então GOTRUE_SITE_URL não
// pode apontar pro domínio do APTicket (quebraria o fallback do outro app)
// - os templates default do GoTrue mostram literalmente "{{ .SiteURL }}" no
// corpo do e-mail ("...to create a user on <SiteURL>"), por isso saía o
// domínio errado mesmo com o link de confirmação certo. Esses templates
// aqui não referenciam SiteURL nenhuma vez - só {{ .ConfirmationURL }} e
// texto fixo "APTicket". Apontar GOTRUE_MAILER_TEMPLATES_INVITE/RECOVERY
// pra essas URLs (ver README).
const BRAND_HEADER = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
  <div style="font-size:20px;font-weight:700;color:#0d2b5e;margin-bottom:24px">APTicket</div>
`;
const BRAND_FOOTER = `
  <p style="font-size:12px;color:#6b7280;margin-top:32px">
    Se você não esperava este e-mail, pode ignorá-lo com segurança.
  </p>
</div>
`;
const BUTTON = (url: string, label: string) => `
  <a href="${url}"
     style="display:inline-block;background:#0d2b5e;color:#fff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600;margin:16px 0">
    ${label}
  </a>
`;

/** Usado pelo healthcheck do docker-compose - sem JWT, sem ficar no Swagger. */
@ApiExcludeController()
@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }

  @Public()
  @Get('mailer-templates/invite')
  @Header('Content-Type', 'text/html; charset=utf-8')
  inviteTemplate(): string {
    return `${BRAND_HEADER}
  <h2 style="font-size:18px;color:#111827">Você foi convidado para o APTicket</h2>
  <p style="font-size:14px;color:#374151;line-height:1.6">
    Você foi convidado a fazer parte de uma equipe no APTicket. Clique no botão abaixo pra
    aceitar o convite e definir sua senha de acesso.
  </p>
  ${BUTTON('{{ .ConfirmationURL }}', 'Aceitar convite')}
${BRAND_FOOTER}`;
  }

  @Public()
  @Get('mailer-templates/recovery')
  @Header('Content-Type', 'text/html; charset=utf-8')
  recoveryTemplate(): string {
    return `${BRAND_HEADER}
  <h2 style="font-size:18px;color:#111827">Redefinir sua senha</h2>
  <p style="font-size:14px;color:#374151;line-height:1.6">
    Recebemos um pedido pra redefinir a senha da sua conta no APTicket. Clique no botão abaixo
    pra escolher uma nova senha.
  </p>
  ${BUTTON('{{ .ConfirmationURL }}', 'Redefinir senha')}
${BRAND_FOOTER}`;
  }
}
