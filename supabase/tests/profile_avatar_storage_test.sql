begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('ab100000-0000-0000-0000-000000000001','Fotos A','avatar-tests-a'),
 ('ab100000-0000-0000-0000-000000000002','Fotos B','avatar-tests-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('ab200000-0000-0000-0000-000000000001','ab100000-0000-0000-0000-000000000001','Fotos A','avatar-a@example.test',true),
 ('ab200000-0000-0000-0000-000000000002','ab100000-0000-0000-0000-000000000001','Outro A','avatar-other@example.test',true),
 ('ab200000-0000-0000-0000-000000000003','ab100000-0000-0000-0000-000000000002','Fotos B','avatar-b@example.test',true);
insert into storage.objects(bucket_id,name) values
 ('apticket-profile-avatars','ab100000-0000-0000-0000-000000000001/ab200000-0000-0000-0000-000000000001/ab300000-0000-0000-0000-000000000001.png'),
 ('apticket-profile-avatars','ab100000-0000-0000-0000-000000000001/ab200000-0000-0000-0000-000000000002/ab300000-0000-0000-0000-000000000002.png'),
 ('apticket-profile-avatars','ab100000-0000-0000-0000-000000000002/ab200000-0000-0000-0000-000000000003/ab300000-0000-0000-0000-000000000003.png');
insert into storage.buckets(id,name,public) values('avatar-test-other-app','avatar-test-other-app',false);
insert into storage.objects(bucket_id,name) values('avatar-test-other-app','fixture.png');
select is((select public from storage.buckets where id='apticket-profile-avatars'),false,'bucket privado');
select is((select file_size_limit from storage.buckets where id='apticket-profile-avatars'),2097152::bigint,'limite de 2 MB');
-- Deliberately simulate a broad policy from another app sharing this Supabase.
create policy avatar_test_legacy_allow_all on storage.objects for all to authenticated,anon using(true) with check(true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ab200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from storage.objects where bucket_id='apticket-profile-avatars'),1::bigint,'leitura isolada por tenant e usuário apesar de policy legada ampla');
select is((select count(*) from storage.objects where bucket_id='avatar-test-other-app'),1::bigint,'não restringe buckets de outros aplicativos');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('apticket-profile-avatars','ab100000-0000-0000-0000-000000000001/ab200000-0000-0000-0000-000000000001/upload.png')$$,'42501',null,'upload direto não contorna validação do servidor');
select lives_ok($$update storage.objects set name='changed.png' where bucket_id='apticket-profile-avatars'$$,'alteração direta não modifica arquivos protegidos');
select is((select count(*) from storage.objects where bucket_id='apticket-profile-avatars' and name like '%ab300000-0000-0000-0000-000000000001.png'),1::bigint,'mantém nome original');
select set_config('request.jwt.claims','{"sub":"ab200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from storage.objects where bucket_id='apticket-profile-avatars'),1::bigint,'outro tenant lê somente sua foto');
reset role;
update apticket.profiles set is_active=false where id='ab200000-0000-0000-0000-000000000003';
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='apticket-profile-avatars'),0::bigint,'perfil inativo não acessa fotos');
reset role;
set local role anon;
select is((select count(*) from storage.objects where bucket_id='apticket-profile-avatars'),0::bigint,'anônimo não acessa fotos mesmo com policy legada ampla');
select is((select count(*) from storage.objects where bucket_id='avatar-test-other-app'),1::bigint,'política anônima preserva outros buckets');
select * from finish();
rollback;
