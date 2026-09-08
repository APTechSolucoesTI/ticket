begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('d1000000-0000-0000-0000-000000000001','Inter test A','inter-test-a'),
 ('d1000000-0000-0000-0000-000000000002','Inter test B','inter-test-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Inter admin','inter-admin@example.test',true),
 ('d2000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','Inter unprivileged','inter-view@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select 'd2000000-0000-0000-0000-000000000001',tenant_id,id from apticket.roles
where tenant_id='d1000000-0000-0000-0000-000000000001' and name='Admin';
set local role service_role;
select lives_ok($$select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000001',
 'd1000000-0000-0000-0000-000000000001','sandbox','123456',
 '{"client_id":"test-id","client_secret":"test-secret","certificate":"test-cert","private_key":"test-key"}',
 '2099-01-01','test-fingerprint',true,false,0)$$,'configuração de homologação salva');
select is((select count(*) from apticket.tenant_inter_configurations where tenant_id='d1000000-0000-0000-0000-000000000001'),1::bigint,'uma configuração salva');
select throws_ok($$select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000001',
 'd1000000-0000-0000-0000-000000000002','sandbox','123456','{}',null,null,false,false,0)$$,'42501',null,'tenant externo rejeitado');
select throws_ok($$select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000002',
 'd1000000-0000-0000-0000-000000000001','sandbox','123456','{}',null,null,false,false,1)$$,'42501',null,'usuário sem permissão rejeitado');
select throws_ok($$select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000001',
 'd1000000-0000-0000-0000-000000000001','production','123456','{}',null,null,true,false,0)$$,'22023',null,'produção exige confirmação');
select throws_ok($$select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000001',
 'd1000000-0000-0000-0000-000000000001','sandbox','123456','{}',null,null,false,false,0)$$,'40001',null,'versão obsoleta rejeitada');
select lives_ok($$select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000001',
 'd1000000-0000-0000-0000-000000000001','production','987654',
 '{"client_id":"official-id","client_secret":"official-secret","certificate":"official-cert","private_key":"official-key"}',
 '2099-01-01','official-fingerprint',true,true,0)$$,'produção confirmada pode ser selecionada');
select is((select count(*) from apticket.tenant_inter_configurations where tenant_id='d1000000-0000-0000-0000-000000000001' and is_active),1::bigint,'somente um ambiente selecionado');
select is((select environment from apticket.tenant_inter_configurations where tenant_id='d1000000-0000-0000-0000-000000000001' and is_active),'production','ambiente oficial selecionado');
select lives_ok($$select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000001',
 'd1000000-0000-0000-0000-000000000001','sandbox','123456','{}',null,null,true,false,2)$$,'pode retornar à homologação sem reenviar segredos');
select throws_ok($$update apticket.tenant_inter_configurations set is_active=true$$,'42501',null,'nem serviço altera configuração fora do RPC');
select is((select count(*) from apticket.inter_configuration_audit where tenant_id='d1000000-0000-0000-0000-000000000001'),5::bigint,'alterações de ambiente auditadas sem segredos');
reset role;
select is((select decrypted_secret::jsonb->>'client_secret' from vault.decrypted_secrets
 where name='apticket_inter_d1000000-0000-0000-0000-000000000001_sandbox'),'test-secret','edição vazia preserva segredo no Vault');
select is((select decrypted_secret::jsonb->>'client_secret' from vault.decrypted_secrets
 where name='apticket_inter_d1000000-0000-0000-0000-000000000001_production'),'official-secret','credenciais dos ambientes independentes');
select ok((select secret <> 'test-secret' from vault.secrets where name='apticket_inter_d1000000-0000-0000-0000-000000000001_sandbox'),'segredo armazenado cifrado');
insert into apticket.user_roles(user_id,tenant_id,role_id)
select 'd2000000-0000-0000-0000-000000000002',tenant_id,id from apticket.roles
where tenant_id='d1000000-0000-0000-0000-000000000001' and name='Admin';
update apticket.profiles set is_active=false where id='d2000000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($$select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000001',
 'd1000000-0000-0000-0000-000000000001','sandbox','123456','{}',null,null,false,false,3)$$,'42501',null,'usuário inativo perde acesso');
set local role authenticated;
select throws_ok($$select * from apticket.tenant_inter_configurations$$,'42501',null,'API não expõe identificadores de segredo');
select throws_ok($$select apticket.save_tenant_inter_configuration(null,null,'sandbox','123456','{}',null,null,false,false,0)$$,'42501',null,'usuário não executa RPC de serviço');
set local role anon;
select throws_ok($$select * from apticket.tenant_inter_configurations$$,'42501',null,'anônimo não consulta configuração');
reset role;
select * from finish();
rollback;
