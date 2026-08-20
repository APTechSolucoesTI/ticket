// Templates de e-mail (convite/redefinição de senha) da autenticação própria
// do APTicket — mesmo estilo visual do template já feito pro GoTrue em
// apps/api/src/app.controller.ts (mailer-templates/invite, /recovery), só que
// aqui é HTML final (não template do GoTrue com {{ .ConfirmationURL }}), já
// que quem manda o e-mail agora é o próprio APTicket via sendMail().

function wrap(bodyHtml: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
  <div style="font-size:20px;font-weight:700;color:#0d2b5e;margin-bottom:24px">APTicket</div>
  ${bodyHtml}
  <p style="font-size:12px;color:#6b7280;margin-top:32px">
    Se você não esperava este e-mail, pode ignorá-lo com segurança.
  </p>
</div>`;
}

function button(url: string, label: string): string {
  return `<a href="${url}"
     style="display:inline-block;background:#0d2b5e;color:#fff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600;margin:16px 0">
    ${label}
  </a>`;
}

export function inviteEmailHtml(url: string): string {
  return wrap(`
  <h2 style="font-size:18px;color:#111827">Você foi convidado para o APTicket</h2>
  <p style="font-size:14px;color:#374151;line-height:1.6">
    Você foi convidado a fazer parte de uma equipe no APTicket. Clique no botão abaixo pra
    aceitar o convite e definir sua senha de acesso.
  </p>
  ${button(url, "Aceitar convite")}`);
}

export function inviteEmailText(url: string): string {
  return `Você foi convidado para o APTicket. Acesse o link pra definir sua senha: ${url}`;
}

export function resetEmailHtml(url: string): string {
  return wrap(`
  <h2 style="font-size:18px;color:#111827">Redefinir sua senha</h2>
  <p style="font-size:14px;color:#374151;line-height:1.6">
    Recebemos um pedido pra redefinir a senha da sua conta no APTicket. Clique no botão abaixo
    pra escolher uma nova senha. Se não foi você, pode ignorar este e-mail.
  </p>
  ${button(url, "Redefinir senha")}`);
}

export function resetEmailText(url: string): string {
  return `Redefinição de senha do APTicket. Acesse o link pra escolher uma nova senha: ${url}`;
}
