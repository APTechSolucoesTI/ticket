begin;

alter table apticket.profiles
  add column if not exists phone text;

alter table apticket.profiles
  drop constraint if exists profiles_phone_format_check,
  add constraint profiles_phone_format_check
    check (phone is null or phone ~ '^[1-9][0-9]{9,14}$');

-- O login próprio do APTicket trata e-mail como identidade global. O índice
-- também fecha a janela de corrida entre a verificação e a atualização.
create unique index if not exists profiles_email_normalized_uidx
  on apticket.profiles (lower(btrim(email)));

-- Telefone pessoal só é lido/alterado pelas funções autenticadas do servidor.
-- Não ampliar os grants de coluna existentes da Data API.
revoke select (phone), update (phone) on apticket.profiles from anon, authenticated;

commit;
