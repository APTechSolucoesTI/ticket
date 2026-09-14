-- Move o cadastro mestre de fornecedores para Gestao e amplia o perfil
-- empresarial com os mesmos dados cadastrais usados em Clientes.
alter table apticket.suppliers
  add column website text,
  add column address_zip text,
  add column address_street text,
  add column address_number text,
  add column address_complement text,
  add column address_neighborhood text,
  add column address_city text,
  add column address_state text,
  add column cnaes jsonb not null default '[]'::jsonb;

alter table apticket.suppliers
  add constraint suppliers_website_length_check
    check (website is null or length(btrim(website)) between 3 and 200),
  add constraint suppliers_address_zip_check
    check (address_zip is null or address_zip ~ '^[0-9]{8}$'),
  add constraint suppliers_address_street_length_check
    check (address_street is null or length(btrim(address_street)) between 1 and 200),
  add constraint suppliers_address_number_length_check
    check (address_number is null or length(btrim(address_number)) between 1 and 20),
  add constraint suppliers_address_complement_length_check
    check (address_complement is null or length(btrim(address_complement)) between 1 and 120),
  add constraint suppliers_address_neighborhood_length_check
    check (address_neighborhood is null or length(btrim(address_neighborhood)) between 1 and 120),
  add constraint suppliers_address_city_length_check
    check (address_city is null or length(btrim(address_city)) between 1 and 100),
  add constraint suppliers_address_state_check
    check (address_state is null or address_state ~ '^[A-Z]{2}$'),
  add constraint suppliers_cnaes_must_be_array_check
    check (jsonb_typeof(cnaes) = 'array');

create or replace function apticket_finance_private.prepare_supplier()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid();
begin
  if tg_op='INSERT' then
    if new.tenant_id is distinct from apticket.current_tenant_id() then
      raise exception using errcode='42501',message='O fornecedor deve pertencer a tenant ativa.';
    end if;
    new.created_by:=v_actor; new.created_at:=clock_timestamp();
  elsif new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
     or new.operating_company_id is distinct from old.operating_company_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='A identidade e a empresa do fornecedor nao podem ser alteradas.';
  elsif old.deleted_at is not null then
    raise exception using errcode='23514',message='Um fornecedor arquivado nao pode ser alterado.';
  end if;
  if tg_op='UPDATE' and old.deleted_at is null and new.deleted_at is not null
     and exists(select 1 from apticket.supplier_contracts c
       where c.supplier_id=old.id and c.deleted_at is null and c.is_active) then
    raise exception using errcode='23514',message='Arquive os contratos ativos antes de arquivar o fornecedor.';
  end if;
  new.legal_name:=btrim(new.legal_name);
  new.trade_name:=nullif(btrim(new.trade_name),'');
  new.tax_id:=nullif(regexp_replace(coalesce(new.tax_id,''),'[^0-9]','','g'),'');
  new.contact_name:=nullif(btrim(new.contact_name),'');
  new.email:=nullif(lower(btrim(new.email)),'');
  new.phone:=nullif(btrim(new.phone),'');
  new.website:=nullif(btrim(new.website),'');
  new.address_zip:=nullif(regexp_replace(coalesce(new.address_zip,''),'[^0-9]','','g'),'');
  new.address_street:=nullif(btrim(new.address_street),'');
  new.address_number:=nullif(btrim(new.address_number),'');
  new.address_complement:=nullif(btrim(new.address_complement),'');
  new.address_neighborhood:=nullif(btrim(new.address_neighborhood),'');
  new.address_city:=nullif(btrim(new.address_city),'');
  new.address_state:=nullif(upper(btrim(new.address_state)),'');
  new.cnaes:=coalesce(new.cnaes,'[]'::jsonb);
  new.notes:=nullif(btrim(new.notes),'');
  new.updated_by:=v_actor; new.updated_at:=clock_timestamp();
  return new;
end $$;

comment on column apticket.suppliers.cnaes is
  'Atividades economicas obtidas da consulta de CNPJ, com uma atividade principal.';

notify pgrst,'reload schema';
