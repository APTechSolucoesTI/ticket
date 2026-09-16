-- Modulo de funcionarios (RH operacional), documentos privados, ferias e folha.

create schema if not exists apticket_hr_private;
revoke all on schema apticket_hr_private from public,anon,authenticated;

insert into apticket.permissions(module,action,description) values
  ('funcionarios','view','Visualizar funcionarios'),
  ('funcionarios','create','Cadastrar funcionarios'),
  ('funcionarios','edit','Alterar funcionarios e historicos'),
  ('funcionarios','delete','Arquivar funcionarios'),
  ('funcionarios','sensitive','Acessar documentos e dados bancarios'),
  ('funcionarios','payroll','Gerar eventos e fechamento de folha')
on conflict(module,action) do update set description=excluded.description;

-- Admin recebe tudo. Papeis que ja operam contas a pagar recebem leitura,
-- dados de pagamento e folha. Um papel RH e criado para cada tenant.
insert into apticket.roles(tenant_id,name,description,is_system)
select tenant.id,'RH','Gestao cadastral, documentos, ferias e folha de funcionarios',false
from apticket.tenants tenant
where not exists(select 1 from apticket.roles role where role.tenant_id=tenant.id and lower(role.name)='rh');

insert into apticket.role_permissions(role_id,permission_id)
select role.id,permission.id from apticket.roles role cross join apticket.permissions permission
where permission.module='funcionarios'
  and lower(role.name) in ('admin','rh')
on conflict do nothing;

insert into apticket.role_permissions(role_id,permission_id)
select distinct existing.role_id,employee_permission.id
from apticket.role_permissions existing
join apticket.permissions finance_permission on finance_permission.id=existing.permission_id
join apticket.permissions employee_permission on employee_permission.module='funcionarios'
  and employee_permission.action in ('view','sensitive','payroll')
where finance_permission.module='financeiro_contas_pagar' and finance_permission.action='edit'
on conflict do nothing;

create table apticket.funcionarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete restrict,
  operating_company_id uuid not null,
  nome_completo text not null check(length(btrim(nome_completo)) between 3 and 250),
  nome_social text check(nome_social is null or length(btrim(nome_social)) between 2 and 250),
  cpf text not null check(cpf ~ '^[0-9]{11}$'),
  rg text,
  rg_orgao_emissor text,
  data_nascimento date not null check(data_nascimento<=current_date),
  sexo text check(sexo is null or sexo in ('feminino','masculino','nao_binario','nao_informado')),
  estado_civil text check(estado_civil is null or estado_civil in ('solteiro','casado','divorciado','viuvo','uniao_estavel','outro')),
  nacionalidade text not null default 'Brasileira',
  naturalidade_cidade text,
  naturalidade_uf text check(naturalidade_uf is null or naturalidade_uf ~ '^[A-Z]{2}$'),
  nome_mae text,
  nome_pai text,
  pis_pasep text not null check(pis_pasep ~ '^[0-9]{11}$'),
  ctps_numero text not null,
  ctps_serie text not null,
  ctps_uf text not null check(ctps_uf ~ '^[A-Z]{2}$'),
  titulo_eleitor text,
  certificado_reservista text,
  email_pessoal text,
  email_corporativo text,
  telefone_principal text,
  telefone_secundario text,
  foto_url text,
  matricula text not null,
  cargo_atual_id uuid,
  departamento text,
  centro_custo_id uuid,
  data_admissao date not null,
  data_demissao date,
  tipo_contrato text not null check(tipo_contrato in ('clt','pj','estagio','aprendiz','temporario')),
  regime_jornada text not null check(regime_jornada in ('integral','meio_periodo','home_office','hibrido')),
  carga_horaria_semanal numeric(6,2) check(carga_horaria_semanal is null or carga_horaria_semanal between 1 and 60),
  status text not null default 'ativo' check(status in ('ativo','afastado','ferias','desligado')),
  motivo_desligamento text,
  tipo_desligamento text check(tipo_desligamento is null or tipo_desligamento in ('sem_justa_causa','com_justa_causa','pedido_demissao','acordo_484a')),
  gestor_responsavel_id uuid,
  fornecedor_id uuid,
  observacoes text check(observacoes is null or length(observacoes)<=8000),
  created_by uuid references apticket.profiles(id) on delete set null,
  updated_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(id,tenant_id),
  unique(id,tenant_id,operating_company_id),
  foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key(centro_custo_id,tenant_id,operating_company_id)
    references apticket.financial_cost_centers(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(gestor_responsavel_id,tenant_id)
    references apticket.funcionarios(id,tenant_id) on delete restrict,
  foreign key(fornecedor_id,tenant_id) references apticket.suppliers(id,tenant_id) on delete restrict,
  check(data_demissao is null or data_demissao>=data_admissao),
  check(status='desligado' or data_demissao is null)
);
create unique index funcionarios_cpf_unique on apticket.funcionarios(tenant_id,cpf) where deleted_at is null;
create unique index funcionarios_matricula_unique on apticket.funcionarios(tenant_id,matricula) where deleted_at is null;
create index funcionarios_status_idx on apticket.funcionarios(tenant_id,status,data_admissao) where deleted_at is null;

create table apticket.funcionario_enderecos (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  funcionario_id uuid not null, tipo text not null check(tipo in ('residencial','correspondencia')),
  cep text not null check(cep ~ '^[0-9]{8}$'), logradouro text not null, numero text not null,
  complemento text, bairro text not null, cidade text not null,
  uf text not null check(uf ~ '^[A-Z]{2}$'), vigente_de date not null default current_date,
  vigente_ate date, is_atual boolean not null default true,
  created_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique(id,tenant_id), foreign key(funcionario_id,tenant_id) references apticket.funcionarios(id,tenant_id) on delete restrict,
  check(vigente_ate is null or vigente_ate>=vigente_de)
);
create unique index funcionario_endereco_atual_unique on apticket.funcionario_enderecos(funcionario_id,tipo)
  where is_atual and deleted_at is null;

create table apticket.funcionario_tipos_documento (
  id uuid primary key default gen_random_uuid(), tenant_id uuid references apticket.tenants(id) on delete cascade,
  nome text not null check(length(btrim(nome)) between 2 and 150), obrigatorio boolean not null default false,
  validade_em_dias integer check(validade_em_dias is null or validade_em_dias>0),
  categoria text not null check(categoria in ('admissional','contratual','fiscal','trabalhista','saude','outros')),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz
);
create unique index funcionario_tipo_doc_tenant_unique on apticket.funcionario_tipos_documento(tenant_id,lower(nome)) where tenant_id is not null and deleted_at is null;
create unique index funcionario_tipo_doc_global_unique on apticket.funcionario_tipos_documento(lower(nome)) where tenant_id is null and deleted_at is null;

create table apticket.funcionario_documentos (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, funcionario_id uuid not null,
  tipo_documento_id uuid not null references apticket.funcionario_tipos_documento(id) on delete restrict,
  numero_documento text, data_emissao date, data_validade date, arquivo_url text not null,
  arquivo_nome_original text not null, arquivo_mime_type text not null check(arquivo_mime_type in ('application/pdf','image/png','image/jpeg')),
  arquivo_tamanho_bytes bigint not null check(arquivo_tamanho_bytes between 1 and 10485760),
  status text not null default 'enviado' check(status in ('pendente','enviado','vencido','aprovado','rejeitado')),
  observacoes_validacao text, enviado_por uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique(id,tenant_id), foreign key(funcionario_id,tenant_id) references apticket.funcionarios(id,tenant_id) on delete restrict,
  check(data_validade is null or data_emissao is null or data_validade>=data_emissao)
);
create index funcionario_documentos_validade_idx on apticket.funcionario_documentos(tenant_id,data_validade,status) where deleted_at is null;

create table apticket.funcionario_cargos_salarios (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, funcionario_id uuid not null,
  cargo text not null check(length(btrim(cargo)) between 2 and 150), nivel text,
  salario_base numeric(12,2) not null check(salario_base>=0),
  tipo_alteracao text not null check(tipo_alteracao in ('admissao','promocao','merito','equiparacao','reducao_acordo','reajuste_coletivo')),
  motivo text, vigente_de date not null, vigente_ate date,
  aprovado_por uuid, documento_aditivo_id uuid,
  created_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique(id,tenant_id), foreign key(funcionario_id,tenant_id) references apticket.funcionarios(id,tenant_id) on delete restrict,
  foreign key(aprovado_por,tenant_id) references apticket.funcionarios(id,tenant_id) on delete restrict,
  foreign key(documento_aditivo_id,tenant_id) references apticket.funcionario_documentos(id,tenant_id) on delete restrict,
  check(vigente_ate is null or vigente_ate>=vigente_de)
);
create unique index funcionario_cargo_atual_unique on apticket.funcionario_cargos_salarios(funcionario_id) where vigente_ate is null and deleted_at is null;
alter table apticket.funcionarios add constraint funcionarios_cargo_atual_fk
  foreign key(cargo_atual_id,tenant_id) references apticket.funcionario_cargos_salarios(id,tenant_id) on delete restrict;

create table apticket.funcionario_ferias (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, funcionario_id uuid not null,
  periodo_aquisitivo_inicio date not null, periodo_aquisitivo_fim date not null,
  periodo_concessivo_limite date not null, dias_direito integer not null default 30 check(dias_direito between 0 and 30),
  dias_vendidos integer not null default 0, dias_gozados integer not null default 0,
  data_inicio_gozo date, data_fim_gozo date,
  status text not null default 'nao_vencidas' check(status in ('nao_vencidas','vencendo','vencidas','agendadas','em_gozo','gozadas','pagas')),
  venda_abono boolean not null default false, adianta_13 boolean not null default false,
  documento_aviso_ferias_id uuid, documento_recibo_ferias_id uuid,
  created_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique(id,tenant_id), foreign key(funcionario_id,tenant_id) references apticket.funcionarios(id,tenant_id) on delete restrict,
  foreign key(documento_aviso_ferias_id,tenant_id) references apticket.funcionario_documentos(id,tenant_id) on delete restrict,
  foreign key(documento_recibo_ferias_id,tenant_id) references apticket.funcionario_documentos(id,tenant_id) on delete restrict,
  check(periodo_aquisitivo_fim>=periodo_aquisitivo_inicio), check(periodo_concessivo_limite>periodo_aquisitivo_fim),
  check(dias_vendidos between 0 and floor(dias_direito/3.0)), check(dias_gozados between 0 and dias_direito),
  check((data_inicio_gozo is null)=(data_fim_gozo is null)), check(data_fim_gozo is null or data_fim_gozo>=data_inicio_gozo)
);
create index funcionario_ferias_alerta_idx on apticket.funcionario_ferias(tenant_id,periodo_concessivo_limite,status) where deleted_at is null;

create table apticket.funcionario_dados_bancarios (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, funcionario_id uuid not null,
  tipo_recebimento text not null check(tipo_recebimento in ('conta_corrente','conta_salario','poupanca','pix')),
  banco_codigo text, banco_nome text, agencia text, agencia_dv text, conta text, conta_dv text,
  tipo_conta text check(tipo_conta is null or tipo_conta in ('corrente','poupanca')),
  chave_pix text, tipo_chave_pix text check(tipo_chave_pix is null or tipo_chave_pix in ('cpf','email','telefone','aleatoria')),
  titular_nome text not null, titular_cpf text not null check(titular_cpf ~ '^[0-9]{11}$'), justificativa_terceiro text,
  vigente_de date not null default current_date, vigente_ate date, is_atual boolean not null default true,
  comprovante_documento_id uuid, created_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique(id,tenant_id), foreign key(funcionario_id,tenant_id) references apticket.funcionarios(id,tenant_id) on delete restrict,
  foreign key(comprovante_documento_id,tenant_id) references apticket.funcionario_documentos(id,tenant_id) on delete restrict,
  check(vigente_ate is null or vigente_ate>=vigente_de),
  check((tipo_recebimento='pix' and chave_pix is not null and tipo_chave_pix is not null) or tipo_recebimento<>'pix')
);
create unique index funcionario_banco_atual_unique on apticket.funcionario_dados_bancarios(funcionario_id) where is_atual and deleted_at is null;

create table apticket.funcionario_eventos_financeiros (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, operating_company_id uuid not null,
  funcionario_id uuid not null,
  tipo_evento text not null check(tipo_evento in ('adiantamento_salarial','pagamento_folha','vale_transporte','vale_refeicao','decimo_terceiro_1a_parcela','decimo_terceiro_2a_parcela','ferias','banco_horas')),
  competencia date not null check(competencia=date_trunc('month',competencia)::date),
  valor_bruto numeric(12,2) not null check(valor_bruto>=0), valor_descontos numeric(12,2) not null default 0 check(valor_descontos>=0),
  valor_liquido numeric(12,2) generated always as (round(valor_bruto-valor_descontos,2)) stored,
  data_prevista_pagamento date not null, ferias_id uuid, conta_pagar_id uuid,
  financial_category_id uuid, cost_center_id uuid,
  status_integracao text not null default 'pendente' check(status_integracao in ('pendente','enviado','confirmado','erro')),
  erro_integracao text, criado_por uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique(id,tenant_id),
  foreign key(funcionario_id,tenant_id,operating_company_id) references apticket.funcionarios(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(ferias_id,tenant_id) references apticket.funcionario_ferias(id,tenant_id) on delete restrict,
  foreign key(conta_pagar_id) references apticket.supplier_payables(id) on delete restrict,
  foreign key(financial_category_id,tenant_id,operating_company_id) references apticket.financial_categories(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(cost_center_id,tenant_id,operating_company_id) references apticket.financial_cost_centers(id,tenant_id,operating_company_id) on delete restrict,
  check(valor_bruto>=valor_descontos)
);
create unique index funcionario_evento_unique on apticket.funcionario_eventos_financeiros(funcionario_id,tipo_evento,competencia) where deleted_at is null;
create index funcionario_eventos_status_idx on apticket.funcionario_eventos_financeiros(tenant_id,operating_company_id,status_integracao,competencia) where deleted_at is null;

create table apticket.funcionario_eventos_financeiros_itens (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, evento_id uuid not null,
  rubrica text not null, tipo text not null check(tipo in ('provento','desconto')), valor numeric(12,2) not null check(valor>=0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  foreign key(evento_id,tenant_id) references apticket.funcionario_eventos_financeiros(id,tenant_id) on delete restrict
);

create table apticket.funcionario_banco_horas_saldo (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, funcionario_id uuid not null,
  competencia date not null, saldo_horas numeric(10,2) not null, adicional_percentual numeric(6,2) not null default 50,
  vence_em date, liquidado_evento_id uuid,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique(funcionario_id,competencia), foreign key(funcionario_id,tenant_id) references apticket.funcionarios(id,tenant_id) on delete restrict,
  foreign key(liquidado_evento_id,tenant_id) references apticket.funcionario_eventos_financeiros(id,tenant_id) on delete restrict
);

create table apticket.funcionario_auditoria (
  id bigint generated always as identity primary key, tenant_id uuid not null,
  funcionario_id uuid, actor_id uuid, action text not null, entity_type text not null,
  entity_id uuid, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default clock_timestamp()
);
create index funcionario_auditoria_idx on apticket.funcionario_auditoria(tenant_id,funcionario_id,created_at desc);

-- Tipos globais sugeridos.
insert into apticket.funcionario_tipos_documento(tenant_id,nome,obrigatorio,validade_em_dias,categoria) values
 (null,'RG',true,null,'admissional'),(null,'CPF',true,null,'admissional'),
 (null,'CTPS - Frente',true,null,'trabalhista'),(null,'CTPS - Verso',true,null,'trabalhista'),
 (null,'Comprovante de Residência',true,90,'admissional'),(null,'Título de Eleitor',false,null,'admissional'),
 (null,'Certificado de Reservista',false,null,'admissional'),(null,'Comprovante de Escolaridade ou Diploma',false,null,'admissional'),
 (null,'Exame Admissional (ASO)',true,365,'saude'),(null,'Contrato de Trabalho Assinado',true,null,'contratual'),
 (null,'Termo de Confidencialidade (NDA)',false,null,'contratual'),(null,'Ficha de EPI',false,365,'trabalhista'),
 (null,'Exame Demissional (ASO)',false,365,'saude'),(null,'Termo de Rescisão (TRCT)',false,null,'trabalhista'),
 (null,'Declaração de Dependentes (IRRF)',false,365,'fiscal'),(null,'Vale-Transporte - Opção ou Recusa',false,365,'trabalhista'),
 (null,'Dados Bancários - Comprovante',true,null,'fiscal'),(null,'Certidão de Casamento ou Nascimento de Dependentes',false,null,'admissional'),
 (null,'CNH',false,1825,'admissional') on conflict do nothing;

create or replace function apticket_hr_private.validate_cpf(value text) returns boolean
language plpgsql immutable strict set search_path=pg_catalog as $$
declare digits text:=regexp_replace(value,'\D','','g'); sum_value integer; digit integer; i integer;
begin
  if length(digits)<>11 or digits ~ '^([0-9])\1{10}$' then return false; end if;
  sum_value:=0; for i in 1..9 loop sum_value:=sum_value+substr(digits,i,1)::integer*(11-i); end loop;
  digit:=(sum_value*10)%11; if digit=10 then digit:=0; end if;
  if digit<>substr(digits,10,1)::integer then return false; end if;
  sum_value:=0; for i in 1..10 loop sum_value:=sum_value+substr(digits,i,1)::integer*(12-i); end loop;
  digit:=(sum_value*10)%11; if digit=10 then digit:=0; end if;
  return digit=substr(digits,11,1)::integer;
end $$;

create or replace function apticket_hr_private.prepare_employee() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare next_number integer;
begin
  new.cpf:=regexp_replace(new.cpf,'\D','','g'); new.pis_pasep:=regexp_replace(new.pis_pasep,'\D','','g');
  if not apticket_hr_private.validate_cpf(new.cpf) then raise exception using errcode='23514',message='CPF inválido.'; end if;
  if nullif(btrim(new.matricula),'') is null then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text,78431));
    select coalesce(max(nullif(regexp_replace(matricula,'\D','','g'),'')::integer),0)+1 into next_number
      from apticket.funcionarios where tenant_id=new.tenant_id;
    new.matricula:='FUN-'||lpad(next_number::text,6,'0');
  end if;
  new.updated_at:=clock_timestamp(); new.updated_by:=coalesce(auth.uid(),new.updated_by);
  return new;
end $$;
create trigger funcionarios_prepare before insert or update on apticket.funcionarios for each row execute function apticket_hr_private.prepare_employee();

create or replace function apticket_hr_private.version_employee_history() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare row_data jsonb:=to_jsonb(new); employee_id uuid; start_date date;
begin
  employee_id:=(row_data->>'funcionario_id')::uuid;
  start_date:=(row_data->>'vigente_de')::date;
  if tg_table_name='funcionario_enderecos' and coalesce((row_data->>'is_atual')::boolean,false) then
    update apticket.funcionario_enderecos set is_atual=false,vigente_ate=start_date-1,updated_at=clock_timestamp()
      where funcionario_id=employee_id and tipo=row_data->>'tipo' and is_atual and deleted_at is null;
  elsif tg_table_name='funcionario_dados_bancarios' and coalesce((row_data->>'is_atual')::boolean,false) then
    update apticket.funcionario_dados_bancarios set is_atual=false,vigente_ate=start_date-1,updated_at=clock_timestamp()
      where funcionario_id=employee_id and is_atual and deleted_at is null;
  elsif tg_table_name='funcionario_cargos_salarios' and row_data->>'vigente_ate' is null then
    update apticket.funcionario_cargos_salarios set vigente_ate=start_date-1,updated_at=clock_timestamp()
      where funcionario_id=employee_id and vigente_ate is null and deleted_at is null;
  end if;
  return new;
end $$;
create trigger funcionario_endereco_version before insert on apticket.funcionario_enderecos for each row execute function apticket_hr_private.version_employee_history();
create trigger funcionario_banco_version before insert on apticket.funcionario_dados_bancarios for each row execute function apticket_hr_private.version_employee_history();
create trigger funcionario_cargo_version before insert on apticket.funcionario_cargos_salarios for each row execute function apticket_hr_private.version_employee_history();

create or replace function apticket_hr_private.set_current_position() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
  if new.vigente_ate is null then update apticket.funcionarios set cargo_atual_id=new.id,updated_at=clock_timestamp() where id=new.funcionario_id; end if;
  return new;
end $$;
create trigger funcionario_cargo_current after insert on apticket.funcionario_cargos_salarios for each row execute function apticket_hr_private.set_current_position();

create or replace function apticket.create_employee_with_position(p_data jsonb,p_cargo text,p_nivel text,p_salario numeric)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare tenant uuid:=apticket.current_tenant_id(); employee_id uuid:=gen_random_uuid(); operator_id uuid; admission date;
begin
  if auth.uid() is null or tenant is null or not apticket.has_permission(auth.uid(),'funcionarios','create') then
    raise exception using errcode='42501',message='Sem permissão para cadastrar funcionários.';
  end if;
  operator_id:=(p_data->>'operating_company_id')::uuid; admission:=(p_data->>'data_admissao')::date;
  if not exists(select 1 from apticket.operating_companies where id=operator_id and tenant_id=tenant and is_active and deleted_at is null) then
    raise exception using errcode='23514',message='Empresa operadora inválida.';
  end if;
  insert into apticket.funcionarios(id,tenant_id,operating_company_id,nome_completo,nome_social,cpf,rg,rg_orgao_emissor,
    data_nascimento,sexo,estado_civil,nacionalidade,naturalidade_cidade,naturalidade_uf,nome_mae,nome_pai,pis_pasep,
    ctps_numero,ctps_serie,ctps_uf,titulo_eleitor,certificado_reservista,email_pessoal,email_corporativo,
    telefone_principal,telefone_secundario,matricula,departamento,centro_custo_id,data_admissao,tipo_contrato,
    regime_jornada,carga_horaria_semanal,status,gestor_responsavel_id,observacoes,created_by,updated_by)
  values(employee_id,tenant,operator_id,btrim(p_data->>'nome_completo'),nullif(btrim(p_data->>'nome_social'),''),p_data->>'cpf',
    nullif(btrim(p_data->>'rg'),''),nullif(btrim(p_data->>'rg_orgao_emissor'),''),(p_data->>'data_nascimento')::date,
    nullif(p_data->>'sexo',''),nullif(p_data->>'estado_civil',''),coalesce(nullif(btrim(p_data->>'nacionalidade'),''),'Brasileira'),
    nullif(btrim(p_data->>'naturalidade_cidade'),''),nullif(p_data->>'naturalidade_uf',''),nullif(btrim(p_data->>'nome_mae'),''),
    nullif(btrim(p_data->>'nome_pai'),''),p_data->>'pis_pasep',p_data->>'ctps_numero',p_data->>'ctps_serie',p_data->>'ctps_uf',
    nullif(btrim(p_data->>'titulo_eleitor'),''),nullif(btrim(p_data->>'certificado_reservista'),''),
    nullif(btrim(p_data->>'email_pessoal'),''),nullif(btrim(p_data->>'email_corporativo'),''),
    nullif(btrim(p_data->>'telefone_principal'),''),nullif(btrim(p_data->>'telefone_secundario'),''),
    coalesce(nullif(btrim(p_data->>'matricula'),''),''),nullif(btrim(p_data->>'departamento'),''),
    nullif(p_data->>'centro_custo_id','')::uuid,admission,p_data->>'tipo_contrato',p_data->>'regime_jornada',
    nullif(p_data->>'carga_horaria_semanal','')::numeric,'ativo',nullif(p_data->>'gestor_responsavel_id','')::uuid,
    nullif(p_data->>'observacoes',''),auth.uid(),auth.uid());
  insert into apticket.funcionario_cargos_salarios(tenant_id,funcionario_id,cargo,nivel,salario_base,tipo_alteracao,
    motivo,vigente_de,created_by) values(tenant,employee_id,btrim(p_cargo),nullif(btrim(p_nivel),''),p_salario,
    'admissao','Cargo e salário de admissão',admission,auth.uid());
  return employee_id;
end $$;

create or replace function apticket_hr_private.prepare_employee_document() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$ declare validity integer; begin
  select validade_em_dias into validity from apticket.funcionario_tipos_documento where id=new.tipo_documento_id and deleted_at is null;
  if new.data_validade is null and new.data_emissao is not null and validity is not null then new.data_validade:=new.data_emissao+validity; end if;
  if new.data_validade is not null and new.data_validade<current_date then new.status:='vencido'; end if;
  new.updated_at:=clock_timestamp(); return new;
end $$;
create trigger funcionario_documento_prepare before insert or update on apticket.funcionario_documentos for each row execute function apticket_hr_private.prepare_employee_document();

create or replace function apticket_hr_private.validate_vacation() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$ begin
  if exists(select 1 from apticket.funcionario_ferias vacation where vacation.funcionario_id=new.funcionario_id
    and vacation.id<>new.id and vacation.deleted_at is null
    and daterange(vacation.periodo_aquisitivo_inicio,vacation.periodo_aquisitivo_fim,'[]') && daterange(new.periodo_aquisitivo_inicio,new.periodo_aquisitivo_fim,'[]')) then
    raise exception using errcode='23P01',message='Já existe período aquisitivo sobreposto para este funcionário.';
  end if;
  return new;
end $$;
create trigger funcionario_ferias_validate before insert or update on apticket.funcionario_ferias for each row execute function apticket_hr_private.validate_vacation();

create or replace function apticket.refresh_employee_compliance() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$ declare docs integer; vacations integer; tenant uuid:=apticket.current_tenant_id(); begin
  if auth.uid() is null or tenant is null or not apticket.has_permission(auth.uid(),'funcionarios','view') then
    raise exception using errcode='42501',message='Sem permissão para atualizar alertas de funcionários.';
  end if;
  update apticket.funcionario_documentos set status='vencido',updated_at=clock_timestamp()
    where tenant_id=tenant and deleted_at is null and data_validade<current_date and status not in ('vencido','rejeitado'); get diagnostics docs=row_count;
  update apticket.funcionario_ferias set status=case
      when data_inicio_gozo<=current_date and data_fim_gozo>=current_date then 'em_gozo'
      when data_fim_gozo<current_date then 'gozadas'
      when data_inicio_gozo>current_date then 'agendadas'
      when periodo_concessivo_limite<current_date then 'vencidas'
      when periodo_concessivo_limite<=current_date+interval '60 days' then 'vencendo'
      else 'nao_vencidas' end,updated_at=clock_timestamp()
    where tenant_id=tenant and deleted_at is null and status<>'pagas'; get diagnostics vacations=row_count;
  return jsonb_build_object('documents',docs,'vacations',vacations);
end $$;

create or replace function apticket.integrate_employee_financial_event(p_event_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare event apticket.funcionario_eventos_financeiros; employee apticket.funcionarios; bank apticket.funcionario_dados_bancarios;
  supplier_id uuid; payable_id uuid; category apticket.financial_categories; center apticket.financial_cost_centers; actor_name text;
begin
  select * into event from apticket.funcionario_eventos_financeiros where id=p_event_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Evento financeiro não encontrado.'; end if;
  if auth.uid() is null or event.tenant_id<>apticket.current_tenant_id() or not (
    apticket.has_permission(auth.uid(),'funcionarios','payroll') or apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit')) then
    raise exception using errcode='42501',message='Sem permissão para integrar a folha ao financeiro.';
  end if;
  if event.conta_pagar_id is not null then return event.conta_pagar_id; end if;
  select * into employee from apticket.funcionarios where id=event.funcionario_id and deleted_at is null;
  select * into bank from apticket.funcionario_dados_bancarios where funcionario_id=employee.id and is_atual and deleted_at is null;
  if bank.id is null then
    update apticket.funcionario_eventos_financeiros set status_integracao='erro',erro_integracao='Dados bancários vigentes não cadastrados' where id=event.id;
    raise exception using errcode='23514',message='Cadastre os dados bancários vigentes antes de gerar a conta a pagar.';
  end if;
  supplier_id:=employee.fornecedor_id;
  if supplier_id is null then select id into supplier_id from apticket.suppliers where tenant_id=event.tenant_id and tax_id=employee.cpf and deleted_at is null limit 1; end if;
  if supplier_id is null then
    insert into apticket.suppliers(tenant_id,legal_name,trade_name,tax_id,category,email,phone,notes,created_by)
      values(event.tenant_id,employee.nome_completo,employee.nome_social,employee.cpf,'other',coalesce(employee.email_corporativo,employee.email_pessoal),employee.telefone_principal,'Favorecido criado automaticamente pelo módulo de funcionários.',auth.uid()) returning id into supplier_id;
  end if;
  update apticket.funcionarios set fornecedor_id=supplier_id where id=employee.id;
  select * into category from apticket.financial_categories where tenant_id=event.tenant_id and operating_company_id=event.operating_company_id
    and (id=event.financial_category_id or (event.financial_category_id is null and code='DES-PESSOAL')) and is_active and deleted_at is null order by (id=event.financial_category_id) desc limit 1;
  select * into center from apticket.financial_cost_centers where tenant_id=event.tenant_id and operating_company_id=event.operating_company_id
    and id=coalesce(event.cost_center_id,employee.centro_custo_id) and is_active and deleted_at is null;
  if category.id is null or center.id is null then raise exception using errcode='23514',message='Informe categoria financeira e centro de custo válidos para o evento.'; end if;
  payable_id:=gen_random_uuid();
  insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
    document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,total_amount,
    allocation_status,status,terms_snapshot,created_by)
  values(payable_id,event.tenant_id,event.operating_company_id,supplier_id,null,
    'RH-'||to_char(event.competencia,'YYYYMM')||'-'||upper(substr(event.id::text,1,8)),
    case event.tipo_evento when 'pagamento_folha' then 'Folha de pagamento' when 'adiantamento_salarial' then 'Adiantamento salarial'
      when 'vale_transporte' then 'Vale-transporte' when 'vale_refeicao' then 'Vale-refeição'
      when 'ferias' then 'Férias' when 'banco_horas' then 'Banco de horas' else '13º salário' end||' - '||employee.nome_completo,
    event.competencia,(event.competencia+interval '1 month')::date,event.data_prevista_pagamento,'fixed',1,event.valor_liquido,event.valor_liquido,
    'complete','scheduled',jsonb_build_object('supplier_name',employee.nome_completo,'employee_id',employee.id,'employee_cpf',employee.cpf,
      'event_id',event.id,'event_type',event.tipo_evento,'bank_snapshot',jsonb_build_object('tipo_recebimento',bank.tipo_recebimento,
      'banco_codigo',bank.banco_codigo,'banco_nome',bank.banco_nome,'agencia',bank.agencia,'agencia_dv',bank.agencia_dv,
      'conta',bank.conta,'conta_dv',bank.conta_dv,'chave_pix',bank.chave_pix,'tipo_chave_pix',bank.tipo_chave_pix,
      'titular_nome',bank.titular_nome,'titular_cpf',bank.titular_cpf)),auth.uid());
  select name into actor_name from apticket.profiles where id=auth.uid();
  insert into apticket.financial_entry_classifications(tenant_id,operating_company_id,source_type,source_id,direction,
    financial_category_id,financial_category_code,financial_category_name,cost_center_id,cost_center_code,cost_center_name,
    notes,classified_by,classified_by_name)
  values(event.tenant_id,event.operating_company_id,'supplier_payable',payable_id,'outflow',category.id,category.code,category.name,
    center.id,center.code,center.name,'Gerado pelo módulo de funcionários',auth.uid(),coalesce(actor_name,'Sistema'));
  update apticket.funcionario_eventos_financeiros set conta_pagar_id=payable_id,status_integracao='enviado',erro_integracao=null,
    financial_category_id=category.id,cost_center_id=center.id,updated_at=clock_timestamp() where id=event.id;
  return payable_id;
exception when others then
  if event.id is not null then update apticket.funcionario_eventos_financeiros set status_integracao='erro',erro_integracao=sqlerrm,updated_at=clock_timestamp() where id=event.id; end if;
  return null;
end $$;

create or replace function apticket.archive_employee(p_employee_id uuid,p_reason text default null) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare employee apticket.funcionarios; begin
  select * into employee from apticket.funcionarios where id=p_employee_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Funcionário não encontrado.'; end if;
  if auth.uid() is null or employee.tenant_id<>apticket.current_tenant_id()
    or not apticket.has_permission(auth.uid(),'funcionarios','delete') then
    raise exception using errcode='42501',message='Sem permissão para arquivar funcionários.';
  end if;
  update apticket.funcionarios set status='desligado',data_demissao=coalesce(data_demissao,current_date),
    motivo_desligamento=coalesce(nullif(trim(p_reason),''),motivo_desligamento),deleted_at=clock_timestamp(),
    updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_employee_id;
end $$;

alter table apticket.supplier_payables drop constraint if exists supplier_payables_origin_type_check;
alter table apticket.supplier_payables add constraint supplier_payables_origin_type_check check(origin_type in ('contract','manual','employee'));

create or replace function apticket_hr_private.confirm_employee_payment() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$ begin
  if new.status='paid' and old.status is distinct from new.status then
    update apticket.funcionario_eventos_financeiros set status_integracao='confirmado',updated_at=clock_timestamp()
      where conta_pagar_id=new.id and deleted_at is null;
  end if; return new;
end $$;
create trigger confirm_employee_payment after update of status on apticket.supplier_payables for each row execute function apticket_hr_private.confirm_employee_payment();

create or replace function apticket_hr_private.audit_employee_mutation() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare row_data jsonb:=to_jsonb(new);
  employee_id uuid; tenant uuid; entity uuid;
begin
  tenant:=(row_data->>'tenant_id')::uuid; entity:=(row_data->>'id')::uuid;
  employee_id:=case when tg_table_name='funcionarios' then entity else nullif(row_data->>'funcionario_id','')::uuid end;
  insert into apticket.funcionario_auditoria(tenant_id,funcionario_id,actor_id,action,entity_type,entity_id,detail)
  values(tenant,employee_id,auth.uid(),lower(tg_op),tg_table_name,entity,
    jsonb_build_object('changed_at',clock_timestamp(),'status',row_data->'status'));
  return new;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['funcionarios','funcionario_enderecos','funcionario_documentos','funcionario_cargos_salarios',
    'funcionario_ferias','funcionario_dados_bancarios','funcionario_eventos_financeiros','funcionario_eventos_financeiros_itens',
    'funcionario_banco_horas_saldo'] loop
    execute format('create trigger employee_mutation_audit after insert or update on apticket.%I for each row execute function apticket_hr_private.audit_employee_mutation()',table_name);
  end loop;
end $$;

create or replace function apticket.log_employee_sensitive_access(p_employee_id uuid,p_action text,p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$ declare tenant uuid; begin
  select tenant_id into tenant from apticket.funcionarios where id=p_employee_id and deleted_at is null;
  if tenant is null or auth.uid() is null or tenant<>apticket.current_tenant_id()
    or not apticket.has_permission(auth.uid(),'funcionarios','sensitive') then raise exception using errcode='42501',message='Sem permissão para acessar dados sensíveis.'; end if;
  insert into apticket.funcionario_auditoria(tenant_id,funcionario_id,actor_id,action,entity_type,entity_id,detail)
    values(tenant,p_employee_id,auth.uid(),left(coalesce(p_action,'view'),80),'funcionario',p_employee_id,coalesce(p_detail,'{}'));
end $$;

-- RLS e privilégios.
do $$ declare table_name text; begin
  foreach table_name in array array['funcionarios','funcionario_enderecos','funcionario_tipos_documento','funcionario_documentos',
    'funcionario_cargos_salarios','funcionario_ferias','funcionario_dados_bancarios','funcionario_eventos_financeiros',
    'funcionario_eventos_financeiros_itens','funcionario_banco_horas_saldo','funcionario_auditoria'] loop
    execute format('alter table apticket.%I enable row level security',table_name);
    execute format('revoke all on apticket.%I from public,anon',table_name);
    execute format('grant select,insert,update on apticket.%I to authenticated',table_name);
    execute format('grant all on apticket.%I to service_role',table_name);
  end loop;
end $$;

create policy employee_read on apticket.funcionarios for select to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','view'));
create policy employee_insert on apticket.funcionarios for insert to authenticated with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','create'));
create policy employee_update on apticket.funcionarios for update to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit')) with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit'));

do $$ declare table_name text; begin
  foreach table_name in array array['funcionario_enderecos','funcionario_cargos_salarios','funcionario_ferias'] loop
    execute format('create policy employee_child_read on apticket.%I for select to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),''funcionarios'',''view''))',table_name);
    execute format('create policy employee_child_write on apticket.%I for insert to authenticated with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),''funcionarios'',''edit''))',table_name);
  end loop;
end $$;
create policy employee_vacation_update on apticket.funcionario_ferias for update to authenticated
  using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit'))
  with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit'));
do $$ declare table_name text; begin
  foreach table_name in array array['funcionario_eventos_financeiros','funcionario_eventos_financeiros_itens','funcionario_banco_horas_saldo'] loop
    execute format('create policy employee_finance_read on apticket.%I for select to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),''funcionarios'',''view''))',table_name);
    execute format('create policy employee_finance_insert on apticket.%I for insert to authenticated with check(tenant_id=apticket.current_tenant_id() and (apticket.has_permission(auth.uid(),''funcionarios'',''payroll'') or apticket.has_permission(auth.uid(),''funcionarios'',''edit'')))',table_name);
    execute format('create policy employee_finance_update on apticket.%I for update to authenticated using(tenant_id=apticket.current_tenant_id() and (apticket.has_permission(auth.uid(),''funcionarios'',''payroll'') or apticket.has_permission(auth.uid(),''funcionarios'',''edit''))) with check(tenant_id=apticket.current_tenant_id() and (apticket.has_permission(auth.uid(),''funcionarios'',''payroll'') or apticket.has_permission(auth.uid(),''funcionarios'',''edit'')))',table_name);
  end loop;
end $$;
create policy employee_document_type_read on apticket.funcionario_tipos_documento for select to authenticated using((tenant_id is null or tenant_id=apticket.current_tenant_id()) and apticket.has_permission(auth.uid(),'funcionarios','view'));
create policy employee_document_type_write on apticket.funcionario_tipos_documento for all to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit')) with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit'));
create policy employee_document_read on apticket.funcionario_documentos for select to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_document_write on apticket.funcionario_documentos for insert to authenticated with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_document_update on apticket.funcionario_documentos for update to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive')) with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_bank_read on apticket.funcionario_dados_bancarios for select to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_bank_write on apticket.funcionario_dados_bancarios for insert to authenticated with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_audit_read on apticket.funcionario_auditoria for select to authenticated using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));

revoke all on function apticket_hr_private.validate_cpf(text),apticket_hr_private.prepare_employee(),apticket_hr_private.version_employee_history(),
  apticket_hr_private.set_current_position(),apticket_hr_private.prepare_employee_document(),apticket_hr_private.validate_vacation(),
  apticket_hr_private.confirm_employee_payment(),apticket_hr_private.audit_employee_mutation() from public,anon,authenticated,service_role;
revoke all on function apticket.create_employee_with_position(jsonb,text,text,numeric),apticket.refresh_employee_compliance(),apticket.integrate_employee_financial_event(uuid),apticket.archive_employee(uuid,text),apticket.log_employee_sensitive_access(uuid,text,jsonb) from public,anon,service_role;
grant execute on function apticket.create_employee_with_position(jsonb,text,text,numeric),apticket.refresh_employee_compliance(),apticket.integrate_employee_financial_event(uuid),apticket.archive_employee(uuid,text),apticket.log_employee_sensitive_access(uuid,text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('funcionario-documentos','funcionario-documentos',false,10485760,array['application/pdf','image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy employee_document_storage_read on storage.objects for select to authenticated using(
  bucket_id='funcionario-documentos' and (storage.foldername(name))[1]=apticket.current_tenant_id()::text
  and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_document_storage_insert on storage.objects for insert to authenticated with check(
  bucket_id='funcionario-documentos' and (storage.foldername(name))[1]=apticket.current_tenant_id()::text
  and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_document_storage_update on storage.objects for update to authenticated using(
  bucket_id='funcionario-documentos' and (storage.foldername(name))[1]=apticket.current_tenant_id()::text
  and apticket.has_permission(auth.uid(),'funcionarios','sensitive')) with check(
  bucket_id='funcionario-documentos' and (storage.foldername(name))[1]=apticket.current_tenant_id()::text
  and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_document_storage_delete on storage.objects for delete to authenticated using(
  bucket_id='funcionario-documentos' and (storage.foldername(name))[1]=apticket.current_tenant_id()::text
  and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));

notify pgrst,'reload schema';
