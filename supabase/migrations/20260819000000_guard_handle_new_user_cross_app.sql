-- Esse projeto Supabase é compartilhado com outro sistema (mesma auth.users
-- global) — o trigger apticket.handle_new_user() (on_auth_user_created)
-- disparava em TODO signup de QUALQUER app que usa esse mesmo Supabase Auth,
-- provisionando tenant+perfil+role admin no APTicket pra gente que nunca
-- teve nada a ver com o sistema. Confirmado ao vivo: existe um segundo
-- trigger (on_auth_user_created_appintura -> public.handle_new_auth_user())
-- na mesma tabela auth.users, prova de que auth.users é mesmo compartilhado.
--
-- Fix: só provisiona se raw_user_meta_data->>'app' = 'apticket' — marcador
-- setado pelo client em apps/web/src/routes/auth.tsx (self-signup) e
-- apps/web/src/lib/users.functions.ts (convite via admin.inviteUserByEmail).
-- Sem o marcador, a função não faz nada (mesmo padrão de guard que o
-- handle_new_auth_user() do outro app já usa pro caso inverso).
--
-- De brinde: convite agora insere o profile direto no tenant de quem
-- convidou (via invited_tenant_id nos metadados) em vez de criar um tenant
-- órfão pra depois apps/web/src/lib/users.functions.ts limpar — o código JS
-- continua fazendo esse cleanup por segurança/idempotência, mas vira no-op
-- no caminho feliz.

create or replace function apticket.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = 'apticket'
as $$
declare
  v_tenant_id uuid;
  v_company text;
  v_name text;
  v_slug text;
  v_invited_tenant_id uuid;
begin
  if coalesce(new.raw_user_meta_data->>'app', '') is distinct from 'apticket' then
    return new;
  end if;

  v_invited_tenant_id := nullif(new.raw_user_meta_data->>'invited_tenant_id', '')::uuid;

  if v_invited_tenant_id is not null then
    insert into apticket.profiles(id, tenant_id, name, email)
    values (
      new.id,
      v_invited_tenant_id,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      new.email
    );
    return new;
  end if;

  v_company := coalesce(new.raw_user_meta_data->>'company_name', split_part(new.email,'@',1) || ' workspace');
  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1));
  v_slug := lower(regexp_replace(v_company,'[^a-zA-Z0-9]+','-','g')) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  insert into apticket.tenants(name, slug) values (v_company, v_slug) returning id into v_tenant_id;
  insert into apticket.profiles(id, tenant_id, name, email) values (new.id, v_tenant_id, v_name, new.email);
  insert into apticket.user_roles(user_id, tenant_id, role) values (new.id, v_tenant_id, 'admin');
  return new;
end;
$$;
