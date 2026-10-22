-- Synthetic rows for domains absent from historical financial fixtures.
-- Keep every production FK, check and trigger active; never install in production.
begin;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
do $$
declare
 t uuid; actor uuid; customer uuid; contact uuid; operating uuid; employee uuid;
 ticket uuid; equipment uuid; family uuid; service uuid; category uuid;
 document uuid; document_type uuid; benefit uuid; event uuid; channel uuid; automation uuid;
begin
 insert into apticket.tenants(name,slug) values('Extended isolation fixture','appsec-extended') returning id into t;
 insert into apticket.profiles(id,tenant_id,name,email) values(gen_random_uuid(),t,'Extended admin','extended@example.test') returning id into actor;
 insert into apticket.user_roles(user_id,tenant_id,role_id) select actor,t,id from apticket.roles where tenant_id=t and name='Admin';
 perform set_config('request.jwt.claims',jsonb_build_object('app','apticket','role','authenticated','sub',actor,'tenant_id',t)::text,true);
 insert into apticket.companies(tenant_id,name) values(t,'Synthetic customer') returning id into customer;
 insert into apticket.contacts(tenant_id,company_id,name,email,is_portal_financial) values(t,customer,'Synthetic contact','contact@example.test',true) returning id into contact;
 insert into apticket.operating_companies(tenant_id,legal_name) values(t,'Synthetic employer') returning id into operating;
 insert into apticket.departments(tenant_id,name) values(t,'Synthetic department');
 insert into apticket.contract_types(tenant_id,name) values(t,'Synthetic contract type');
 insert into apticket.feriados(tenant_id,data,nome,abrangencia) values(t,'2026-10-22','Synthetic tenant holiday','tenant');
 insert into apticket.tickets(tenant_id,company_id,contact_id,subject) values(t,customer,contact,'Synthetic extended ticket') returning id into ticket;
 insert into apticket.equipments(tenant_id,company_id,name) values(t,customer,'Synthetic equipment') returning id into equipment;
 insert into apticket.ticket_equipments(tenant_id,ticket_id,equipment_id) values(t,ticket,equipment);
 insert into apticket.csat_responses(tenant_id,ticket_id,contact_id,rating) values(t,ticket,contact,5);
 insert into apticket.ticket_closing_reports(tenant_id,ticket_id,token,generated_by) values(t,ticket,'synthetic-report-capability',actor);
 insert into apticket.ticket_pauses(tenant_id,ticket_id,reason_snapshot,paused_by) values(t,ticket,'Synthetic pause',actor);
 insert into apticket.service_families(tenant_id,code,description) values(t,'SYNTH','Synthetic family') returning id into family;
 insert into apticket.provided_services(tenant_id,code,description,family_id,includes_remote) values(t,'SYNTH','Synthetic service',family,true) returning id into service;
 insert into apticket.ticket_services_performed(tenant_id,ticket_id,provided_service_id,created_by) values(t,ticket,service,actor);
 insert into apticket.kb_categories(tenant_id,name,slug) values(t,'Synthetic category','synthetic-category') returning id into category;
 insert into apticket.kb_articles(tenant_id,category_id,title,slug,created_by) values(t,category,'Synthetic article','synthetic-article',actor);
 insert into apticket.user_permissions(tenant_id,user_id,permission_id,granted,created_by)
  select t,actor,id,true,actor from apticket.permissions where module='tickets' and action='view' limit 1;
 insert into apticket.permission_audit_log(tenant_id,actor_id,action,target_type,target_id)
  values(t,actor,'synthetic_grant','user',actor);
 insert into apticket.whatsapp_pending_messages(tenant_id,contact_id,phone,content) values(t,contact,'5500000000000','Synthetic pending message');
 insert into apticket.client_documents(tenant_id,company_id,document_type,competencia,file_name,file_path,mime_type,uploaded_by)
  values(t,customer,'fatura','2026-10-01','synthetic.pdf',t||'/'||customer||'/synthetic.pdf','application/pdf',actor) returning id into document;
 insert into apticket.document_downloads(tenant_id,document_id,contact_id) values(t,document,contact);
 insert into apticket.outbound_channels(tenant_id,name,base_url,access_token,active)
  values(t,'Synthetic channel','https://uazapi.example.test','synthetic-encrypted-placeholder',false) returning id into channel;
 insert into apticket.automations(tenant_id,name,trigger_id,outbound_channel_id,recipient_profile,template_id,active)
  select t,'Synthetic automation','documentos_disponibilizados',channel,'financeiro',id,false
  from apticket.canned_responses where tenant_id=t and title='Documentos Disponibilizados' returning id into automation;
 insert into apticket.automation_executions(tenant_id,automation_id,company_id,status) values(t,automation,customer,'skipped');
 insert into apticket.funcionarios(tenant_id,operating_company_id,nome_completo,matricula,data_admissao,tipo_contrato,regime_jornada)
  values(t,operating,'Synthetic employee','SYNTH-001','2026-01-01','clt','integral') returning id into employee;
 insert into apticket.funcionario_tipos_documento(tenant_id,nome,categoria) values(t,'Synthetic document','outros') returning id into document_type;
 insert into apticket.funcionario_documentos(tenant_id,funcionario_id,tipo_documento_id,arquivo_url,arquivo_nome_original,arquivo_mime_type,arquivo_tamanho_bytes)
  values(t,employee,document_type,t||'/'||employee||'/synthetic.pdf','synthetic.pdf','application/pdf',32);
 insert into apticket.funcionario_beneficios(tenant_id,funcionario_id,tipo_beneficio,vigente_de,valor)
  values(t,employee,'Synthetic benefit','2026-01-01',100) returning id into benefit;
 insert into apticket.funcionario_beneficio_documentos(tenant_id,funcionario_id,beneficio_id,arquivo_url,arquivo_nome_original,arquivo_mime_type,arquivo_tamanho_bytes)
  values(t,employee,benefit,t||'/'||employee||'/'||benefit||'/synthetic.pdf','synthetic.pdf','application/pdf',32);
 insert into apticket.funcionario_cargos_salarios(tenant_id,funcionario_id,cargo,salario_base,tipo_alteracao,vigente_de)
  values(t,employee,'Synthetic engineer',1000,'Admissao','2026-01-01');
 insert into apticket.funcionario_enderecos(tenant_id,funcionario_id,tipo,cep,logradouro,numero,bairro,cidade,uf)
  values(t,employee,'residencial','00000000','Synthetic street','1','Synthetic district','Synthetic city','SP');
 insert into apticket.funcionario_dados_bancarios(tenant_id,funcionario_id,tipo_recebimento,titular_nome,titular_cpf,chave_pix,tipo_chave_pix)
  values(t,employee,'pix','Synthetic employee','00000000000','fixture@example.test','email');
 insert into apticket.funcionario_ferias(tenant_id,funcionario_id,periodo_aquisitivo_inicio,periodo_aquisitivo_fim,periodo_concessivo_limite)
  values(t,employee,'2025-01-01','2025-12-31','2026-12-31');
 insert into apticket.funcionario_banco_horas_saldo(tenant_id,funcionario_id,competencia,saldo_horas)
  values(t,employee,'2026-10-01',8);
 insert into apticket.funcionario_eventos_financeiros(tenant_id,operating_company_id,funcionario_id,tipo_evento,competencia,valor_bruto,data_prevista_pagamento)
  values(t,operating,employee,'pagamento_folha','2026-10-01',1000,'2026-10-30') returning id into event;
 insert into apticket.funcionario_eventos_financeiros_itens(tenant_id,evento_id,rubrica,tipo,valor)
  values(t,event,'Synthetic salary','provento',1000);
end $$;

-- HR audit rows must come from production triggers. Permission audit records
-- mirror the API producer. The runner probes populated domains as an outsider.
select ok(exists(select 1 from apticket.funcionario_auditoria),'employee triggers produced tenant audit rows');
select ok(exists(select 1 from apticket.permission_audit_log),'synthetic permission audit row is available for isolation probe');
set local role authenticated;
select is((select count(*) from apticket.funcionarios),1::bigint,'own tenant admin sees synthetic employee');
select is((select count(*) from apticket.kb_articles),1::bigint,'own tenant admin sees synthetic article');
select is((select count(*) from apticket.ticket_equipments),1::bigint,'own tenant admin sees synthetic ticket equipment');
select * from finish();
rollback;
