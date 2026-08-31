-- Catálogo de permissões v2 - pedido explícito do usuário: matriz exata por
-- módulo (Tickets/Fila WhatsApp/Fila E-mail/Clientes/Contatos/Equipamentos/
-- Contratos/Base de Conhecimento com CRUD completo; Relatórios só view;
-- Configurações vira item PAI (view/edit) com 12 sub-itens cada um com sua
-- própria granularidade - Empresa e Canais só view/edit, resto CRUD
-- completo). Regra de cascata (view desmarcado bloqueia o resto E o menu; em
-- Configurações também esconde os sub-itens) fica no frontend - aqui só o
-- catálogo/RLS/seed.
--
-- Troca destrutiva do catálogo (delete-all + reinsert): seguro agora porque
-- só existem os 3 papéis default seedados (sem papel custom sobrevivendo -
-- o de teste já foi removido) e user_permissions já foi zerado (overrides
-- de teste limpos). ON DELETE CASCADE em role_permissions/user_permissions
-- cuida do resto.

begin;

truncate apticket.role_permissions;
delete from apticket.user_permissions;
delete from apticket.permissions;

insert into apticket.permissions (module, action) values
  ('tickets','view'),('tickets','create'),('tickets','edit'),('tickets','delete'),
  ('fila_whatsapp','view'),('fila_whatsapp','create'),('fila_whatsapp','edit'),('fila_whatsapp','delete'),
  ('fila_email','view'),('fila_email','create'),('fila_email','edit'),('fila_email','delete'),
  ('clientes','view'),('clientes','create'),('clientes','edit'),('clientes','delete'),
  ('contatos','view'),('contatos','create'),('contatos','edit'),('contatos','delete'),
  ('equipamentos','view'),('equipamentos','create'),('equipamentos','edit'),('equipamentos','delete'),
  ('contratos','view'),('contratos','create'),('contratos','edit'),('contratos','delete'),
  ('base_conhecimento','view'),('base_conhecimento','create'),('base_conhecimento','edit'),('base_conhecimento','delete'),
  ('relatorios','view'),
  ('configuracoes','view'),('configuracoes','edit'),
  ('empresa','view'),('empresa','edit'),
  ('usuarios','view'),('usuarios','create'),('usuarios','edit'),('usuarios','delete'),
  ('papeis','view'),('papeis','create'),('papeis','edit'),('papeis','delete'),
  ('permissoes','view'),('permissoes','create'),('permissoes','edit'),('permissoes','delete'),
  ('departamentos','view'),('departamentos','create'),('departamentos','edit'),('departamentos','delete'),
  ('familia_servicos','view'),('familia_servicos','create'),('familia_servicos','edit'),('familia_servicos','delete'),
  ('servicos_prestados','view'),('servicos_prestados','create'),('servicos_prestados','edit'),('servicos_prestados','delete'),
  ('tipos_contrato','view'),('tipos_contrato','create'),('tipos_contrato','edit'),('tipos_contrato','delete'),
  ('slas','view'),('slas','create'),('slas','edit'),('slas','delete'),
  ('respostas_padrao','view'),('respostas_padrao','create'),('respostas_padrao','edit'),('respostas_padrao','delete'),
  ('figurinhas','view'),('figurinhas','create'),('figurinhas','edit'),('figurinhas','delete'),
  ('canais','view'),('canais','edit');

-- ============================================================
-- Reseed dos papéis default já existentes (2 tenants, papéis is_system=
-- admin ganham tudo; os demais ganham a mesma paridade de antes, só que
-- reexpressa na granularidade nova)
-- ============================================================

insert into apticket.role_permissions (role_id, permission_id)
  select r.id, p.id from apticket.roles r cross join apticket.permissions p where r.is_system;

insert into apticket.role_permissions (role_id, permission_id)
  select r.id, p.id from apticket.roles r cross join apticket.permissions p
  where not r.is_system
    and p.module not in ('papeis','permissoes','usuarios')
    and not (p.module = 'canais' and p.action = 'edit')
    and not (p.module = 'empresa' and p.action = 'edit')
    and not (p.module = 'configuracoes' and p.action = 'edit')
    and not (p.module = 'base_conhecimento' and p.action in ('create','edit','delete'))
    and not (p.module = 'respostas_padrao' and p.action in ('create','edit','delete'))
    and not (
      p.module in ('departamentos','familia_servicos','servicos_prestados','tipos_contrato','slas','figurinhas')
      and p.action in ('create','edit','delete')
    );

-- corrige o dado que ficou faltando: tenant Gabriel APTECH só tinha 2 papéis
-- (Admin/Agente) - completa com Solicitante, igual o outro tenant, mesma
-- paridade do Agente.
insert into apticket.roles (tenant_id, name, description, is_system)
select t.id, 'Solicitante', 'Abre e acompanha os próprios tickets', false
from apticket.tenants t
where not exists (
  select 1 from apticket.roles r where r.tenant_id = t.id and r.name = 'Solicitante'
);

insert into apticket.role_permissions (role_id, permission_id)
  select r.id, p.id from apticket.roles r cross join apticket.permissions p
  where r.name = 'Solicitante'
    and not exists (select 1 from apticket.role_permissions rp where rp.role_id = r.id)
    and p.module not in ('papeis','permissoes','usuarios')
    and not (p.module = 'canais' and p.action = 'edit')
    and not (p.module = 'empresa' and p.action = 'edit')
    and not (p.module = 'configuracoes' and p.action = 'edit')
    and not (p.module = 'base_conhecimento' and p.action in ('create','edit','delete'))
    and not (p.module = 'respostas_padrao' and p.action in ('create','edit','delete'))
    and not (
      p.module in ('departamentos','familia_servicos','servicos_prestados','tipos_contrato','slas','figurinhas')
      and p.action in ('create','edit','delete')
    );

-- ============================================================
-- Atualiza a função de seed pra tenant novo usar o catálogo v2
-- ============================================================

create or replace function apticket.seed_tenant_default_roles(_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = apticket
as $$
declare
  v_admin uuid;
  v_agent uuid;
  v_req uuid;
begin
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Admin', 'Acesso total ao workspace', true)
    returning id into v_admin;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Agente', 'Atende tickets e opera o dia a dia', false)
    returning id into v_agent;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Solicitante', 'Abre e acompanha os próprios tickets', false)
    returning id into v_req;

  insert into apticket.role_permissions (role_id, permission_id)
    select v_admin, id from apticket.permissions;

  insert into apticket.role_permissions (role_id, permission_id)
    select r, id
    from apticket.permissions, unnest(array[v_agent, v_req]) as r
    where module not in ('papeis','permissoes','usuarios')
      and not (module = 'canais' and action = 'edit')
      and not (module = 'empresa' and action = 'edit')
      and not (module = 'configuracoes' and action = 'edit')
      and not (module = 'base_conhecimento' and action in ('create','edit','delete'))
      and not (module = 'respostas_padrao' and action in ('create','edit','delete'))
      and not (
        module in ('departamentos','familia_servicos','servicos_prestados','tipos_contrato','slas','figurinhas')
        and action in ('create','edit','delete')
      );
end;
$$;

-- ============================================================
-- RLS: remapeia as tabelas cujo módulo mudou de nome/granularidade
-- (tickets/companies/contacts/equipments/contracts + tabelas-filha e
-- profiles/user_roles ficam iguais - módulo não mudou)
-- ============================================================

-- kb_articles/kb_categories: base_conhecimento vira CRUD completo (era só
-- view/write) - só a policy de escrita muda, splitta em 3.
drop policy "kb_articles admin write" on apticket.kb_articles;
create policy "kb_articles insert" on apticket.kb_articles for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','create'));
create policy "kb_articles update" on apticket.kb_articles for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','edit'));
create policy "kb_articles delete" on apticket.kb_articles for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','delete'));

drop policy "kb_categories admin write" on apticket.kb_categories;
create policy "kb_categories insert" on apticket.kb_categories for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','create'));
create policy "kb_categories update" on apticket.kb_categories for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','edit'));
create policy "kb_categories delete" on apticket.kb_categories for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','delete'));

-- canned_responses: respostas_prontas -> respostas_padrao, write vira create/edit/delete
drop policy "canned_responses select" on apticket.canned_responses;
drop policy "canned_responses insert" on apticket.canned_responses;
drop policy "canned_responses update" on apticket.canned_responses;
drop policy "canned_responses delete" on apticket.canned_responses;
create policy "canned_responses select" on apticket.canned_responses for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_padrao','view'));
create policy "canned_responses insert" on apticket.canned_responses for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_padrao','create'));
create policy "canned_responses update" on apticket.canned_responses for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_padrao','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_padrao','edit'));
create policy "canned_responses delete" on apticket.canned_responses for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_padrao','delete'));

-- stickers: configuracoes -> figurinhas
drop policy "stickers select" on apticket.stickers;
drop policy "stickers insert" on apticket.stickers;
drop policy "stickers update" on apticket.stickers;
drop policy "stickers delete" on apticket.stickers;
create policy "stickers select" on apticket.stickers for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'figurinhas','view'));
create policy "stickers insert" on apticket.stickers for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'figurinhas','create'));
create policy "stickers update" on apticket.stickers for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'figurinhas','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'figurinhas','edit'));
create policy "stickers delete" on apticket.stickers for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'figurinhas','delete'));

-- departments: configuracoes -> departamentos
drop policy "departments select" on apticket.departments;
drop policy "departments insert" on apticket.departments;
drop policy "departments update" on apticket.departments;
drop policy "departments delete" on apticket.departments;
create policy "departments select" on apticket.departments for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'departamentos','view'));
create policy "departments insert" on apticket.departments for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'departamentos','create'));
create policy "departments update" on apticket.departments for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'departamentos','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'departamentos','edit'));
create policy "departments delete" on apticket.departments for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'departamentos','delete'));

-- service_families: configuracoes -> familia_servicos
drop policy "service_families select" on apticket.service_families;
drop policy "service_families insert" on apticket.service_families;
drop policy "service_families update" on apticket.service_families;
drop policy "service_families delete" on apticket.service_families;
create policy "service_families select" on apticket.service_families for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'familia_servicos','view'));
create policy "service_families insert" on apticket.service_families for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'familia_servicos','create'));
create policy "service_families update" on apticket.service_families for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'familia_servicos','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'familia_servicos','edit'));
create policy "service_families delete" on apticket.service_families for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'familia_servicos','delete'));

-- provided_services: configuracoes -> servicos_prestados
drop policy "provided_services select" on apticket.provided_services;
drop policy "provided_services insert" on apticket.provided_services;
drop policy "provided_services update" on apticket.provided_services;
drop policy "provided_services delete" on apticket.provided_services;
create policy "provided_services select" on apticket.provided_services for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'servicos_prestados','view'));
create policy "provided_services insert" on apticket.provided_services for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'servicos_prestados','create'));
create policy "provided_services update" on apticket.provided_services for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'servicos_prestados','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'servicos_prestados','edit'));
create policy "provided_services delete" on apticket.provided_services for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'servicos_prestados','delete'));

-- contract_types: configuracoes -> tipos_contrato (write vira create/edit/delete)
drop policy "contract_types admin write" on apticket.contract_types;
create policy "contract_types insert" on apticket.contract_types for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tipos_contrato','create'));
create policy "contract_types update" on apticket.contract_types for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tipos_contrato','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tipos_contrato','edit'));
create policy "contract_types delete" on apticket.contract_types for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tipos_contrato','delete'));
-- "contract_types read tenant" (SELECT, sem gate) fica igual.

-- sla_policies: configuracoes -> slas (write vira create/edit/delete)
drop policy "sla admin write" on apticket.sla_policies;
create policy "sla_policies insert" on apticket.sla_policies for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'slas','create'));
create policy "sla_policies update" on apticket.sla_policies for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'slas','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'slas','edit'));
create policy "sla_policies delete" on apticket.sla_policies for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'slas','delete'));
-- "sla read tenant" (SELECT, sem gate) fica igual.

-- tenants: configuracoes -> empresa
drop policy "admins update tenant" on apticket.tenants;
create policy "admins update tenant" on apticket.tenants for update to authenticated
  using (id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'empresa','edit'))
  with check (id = apticket.current_tenant_id());
-- "tenant members read tenant" (SELECT, sem gate) fica igual.

-- email_pending_messages: canais:send -> fila_email, vira CRUD completo (era 1 policy ALL)
drop policy "email_pending_messages manage" on apticket.email_pending_messages;
create policy "email_pending_messages select" on apticket.email_pending_messages for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_email','view'));
create policy "email_pending_messages insert" on apticket.email_pending_messages for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_email','create'));
create policy "email_pending_messages update" on apticket.email_pending_messages for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_email','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_email','edit'));
create policy "email_pending_messages delete" on apticket.email_pending_messages for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_email','delete'));

-- whatsapp_pending_messages: canais:send -> fila_whatsapp
drop policy "whatsapp_pending_messages manage" on apticket.whatsapp_pending_messages;
create policy "whatsapp_pending_messages select" on apticket.whatsapp_pending_messages for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_whatsapp','view'));
create policy "whatsapp_pending_messages insert" on apticket.whatsapp_pending_messages for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_whatsapp','create'));
create policy "whatsapp_pending_messages update" on apticket.whatsapp_pending_messages for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_whatsapp','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_whatsapp','edit'));
create policy "whatsapp_pending_messages delete" on apticket.whatsapp_pending_messages for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'fila_whatsapp','delete'));

-- roles: papeis vira CRUD completo (era view/manage)
drop policy "roles manage" on apticket.roles;
create policy "roles insert" on apticket.roles for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'papeis','create'));
create policy "roles update" on apticket.roles for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'papeis','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'papeis','edit'));
create policy "roles delete" on apticket.roles for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'papeis','delete'));
-- "roles read tenant" (SELECT, sem gate) fica igual.

-- role_permissions: matriz de um papel = editar o papel -> papeis:edit
drop policy "role_permissions manage" on apticket.role_permissions;
create policy "role_permissions manage" on apticket.role_permissions for all to authenticated
  using (
    exists (select 1 from apticket.roles r where r.id = role_id and r.tenant_id = apticket.current_tenant_id())
    and apticket.has_permission(auth.uid(),'papeis','edit')
  )
  with check (
    exists (select 1 from apticket.roles r where r.id = role_id and r.tenant_id = apticket.current_tenant_id())
    and apticket.has_permission(auth.uid(),'papeis','edit')
  );
-- "role_permissions read tenant" (SELECT, sem gate) fica igual.

-- user_permissions: vira módulo próprio "permissoes" (era papeis:manage)
drop policy "user_permissions manage" on apticket.user_permissions;
create policy "user_permissions manage" on apticket.user_permissions for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'permissoes','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'permissoes','edit'));
-- "user_permissions read tenant" (SELECT, sem gate) fica igual.

commit;
