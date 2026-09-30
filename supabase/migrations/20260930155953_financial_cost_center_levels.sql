-- Centros de custo passam a usar codigos visiveis por nivel:
-- 99 (grupo), 99.99 (subgrupo) e 99.99.9999 (centro analitico).
update apticket.financial_cost_centers
set code = substring(code from 1 for 2),
    updated_at = clock_timestamp()
where classification_type = 'synthetic'
  and code ~ '^[0-9]{2}\.00\.0000$';

update apticket.financial_cost_centers
set code = substring(code from 1 for 5),
    updated_at = clock_timestamp()
where classification_type = 'synthetic'
  and code ~ '^[0-9]{2}\.[0-9]{2}\.0000$';

create or replace function apticket.save_financial_cost_center(
  p_id uuid,p_operating_company_id uuid,p_code text,p_name text,p_description text default null,
  p_is_global boolean default false,p_is_active boolean default true,
  p_classification_type text default 'analytic'
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_id uuid; current_row apticket.financial_cost_centers; begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Empresa operadora nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar centros de custo.';
  end if;
  if coalesce(btrim(p_code),'') !~ '^([0-9]{2}|[0-9]{2}\.[0-9]{2}|[0-9]{2}\.[0-9]{2}\.[0-9]{4})$'
    or length(btrim(coalesce(p_name,''))) not between 2 and 150
    or p_classification_type not in ('analytic','synthetic') then
    raise exception using errcode='23514',message='Informe codigo no formato 99.99.9999, nome e tipo validos para o centro de custo.';
  end if;
  if (p_classification_type='synthetic' and coalesce(btrim(p_code),'') !~ '^([0-9]{2}|[0-9]{2}\.[0-9]{2})$')
    or (p_classification_type='analytic' and coalesce(btrim(p_code),'') !~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$') then
    raise exception using errcode='23514',message='Use codigos 99 ou 99.99 para centros de custo sinteticos e 99.99.9999 para centros de custo analiticos.';
  end if;
  if exists(
    select 1 from apticket.financial_cost_centers item
    where item.tenant_id=v_tenant and item.id is distinct from p_id and item.deleted_at is null
      and lower(item.code)=lower(btrim(p_code))
      and (item.is_global or p_is_global or item.operating_company_id=p_operating_company_id)
  ) then
    raise exception using errcode='23505',message='Ja existe um centro de custo com este codigo no escopo informado.';
  end if;
  if p_id is null then
    v_id:=gen_random_uuid();
    insert into apticket.financial_cost_centers(
      id,tenant_id,operating_company_id,code,name,description,is_global,is_active,classification_type,created_by,updated_by
    ) values(
      v_id,v_tenant,p_operating_company_id,btrim(p_code),btrim(p_name),nullif(btrim(p_description),''),
      p_is_global,p_is_active,p_classification_type,auth.uid(),auth.uid()
    );
  else
    select * into current_row from apticket.financial_cost_centers
      where id=p_id and tenant_id=v_tenant and deleted_at is null for update;
    if not found or (current_row.operating_company_id<>p_operating_company_id and not current_row.is_global) then
      raise exception using errcode='P0002',message='Centro de custo nao encontrado.';
    end if;
    if exists(select 1 from apticket.financial_entry_classifications where cost_center_id=p_id)
      and row(current_row.code,current_row.name,current_row.description,current_row.is_global,current_row.classification_type)
        is distinct from row(btrim(p_code),btrim(p_name),nullif(btrim(p_description),''),p_is_global,p_classification_type) then
      raise exception using errcode='23514',message='Este centro de custo ja foi utilizado; somente o status Ativo pode ser alterado.';
    end if;
    update apticket.financial_cost_centers set code=btrim(p_code),name=btrim(p_name),
      description=nullif(btrim(p_description),''),is_global=p_is_global,is_active=p_is_active,
      classification_type=p_classification_type,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=p_id;
    v_id:=p_id;
  end if;
  return v_id;
end $$;

comment on column apticket.financial_cost_centers.code is
  'Codigo hierarquico: 99 e 99.99 para niveis sinteticos; 99.99.9999 para o nivel analitico.';
