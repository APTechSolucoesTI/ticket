-- Autenticação própria do APTicket (Bloco 1) — ver plano em
-- C:\Users\luiz.esposito\.claude\plans\vectorized-painting-puppy.md
--
-- Esse Supabase é compartilhado com outro sistema (mesma auth.users global) —
-- convidar um e-mail que já existe em auth.users de OUTRO sistema bloqueava o
-- convite no APTicket com "usuário já cadastrado". Fix: parar de depender de
-- auth.users pra qualquer coisa (login, convite, checagem de duplicidade).
--
-- RLS continua funcionando (37 policies, todas via current_tenant_id() ->
-- auth.uid()) — decisão foi manter isso assinando JWT compatível com o
-- PostgREST (mesmo JWT_SECRET que o GoTrue já usa), não desativar RLS. Migration
-- só precisa parar de EXIGIR que profiles.id (e as 6 FKs que dependiam dela)
-- tenham uma linha correspondente em auth.users — profiles.id vira uma uuid
-- livre, RLS/auth.uid() nem sabem a diferença (continuam lendo o claim `sub`
-- do JWT, venha ele do GoTrue ou de código nosso).

alter table apticket.profiles add column if not exists password_hash text;

alter table apticket.profiles drop constraint if exists profiles_id_fkey;

alter table apticket.user_roles drop constraint if exists user_roles_user_id_fkey;
alter table apticket.user_roles
  add constraint user_roles_user_id_fkey
  foreign key (user_id) references apticket.profiles(id) on delete cascade;

alter table apticket.tickets drop constraint if exists tickets_assigned_to_fkey;
alter table apticket.tickets
  add constraint tickets_assigned_to_fkey
  foreign key (assigned_to) references apticket.profiles(id) on delete set null;

alter table apticket.messages drop constraint if exists messages_author_id_fkey;
alter table apticket.messages
  add constraint messages_author_id_fkey
  foreign key (author_id) references apticket.profiles(id) on delete set null;

alter table apticket.time_entries drop constraint if exists time_entries_agent_id_fkey;
alter table apticket.time_entries
  add constraint time_entries_agent_id_fkey
  foreign key (agent_id) references apticket.profiles(id) on delete cascade;

alter table apticket.canned_responses drop constraint if exists canned_responses_created_by_fkey;
alter table apticket.canned_responses
  add constraint canned_responses_created_by_fkey
  foreign key (created_by) references apticket.profiles(id) on delete set null;

alter table apticket.kb_articles drop constraint if exists kb_articles_created_by_fkey;
alter table apticket.kb_articles
  add constraint kb_articles_created_by_fkey
  foreign key (created_by) references apticket.profiles(id) on delete set null;

create table if not exists apticket.invites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references apticket.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invites_profile_idx on apticket.invites(profile_id);
grant select, insert, update on apticket.invites to service_role;
alter table apticket.invites enable row level security;
-- Sem policy pra authenticated de propósito: só service_role (server-side,
-- apps/web) toca essa tabela — nunca é lida/escrita do browser.

create table if not exists apticket.password_resets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references apticket.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_resets_profile_idx on apticket.password_resets(profile_id);
grant select, insert, update on apticket.password_resets to service_role;
alter table apticket.password_resets enable row level security;
