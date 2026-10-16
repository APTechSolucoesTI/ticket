-- Private files are staged per tenant/company/uploader, then linked atomically.
create table apticket.supplier_payable_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id),
  operating_company_id uuid not null references apticket.operating_companies(id),
  supplier_payable_id uuid not null references apticket.supplier_payables(id),
  storage_path text not null unique,
  file_name text not null check(length(file_name) between 1 and 255),
  file_size bigint not null check(file_size between 1 and 10485760),
  content_type text not null,
  attachment_type text not null check(attachment_type in ('boleto','nota_fiscal','xml','outros')),
  type_description text,
  created_by uuid not null references apticket.profiles(id),
  created_at timestamptz not null default now(),
  check ((attachment_type='outros' and length(btrim(type_description)) between 1 and 200 and type_description is not null)
    or (attachment_type<>'outros' and type_description is null))
);
create index supplier_payable_attachments_payable_idx on apticket.supplier_payable_attachments(supplier_payable_id);
create index supplier_payable_attachments_tenant_company_idx on apticket.supplier_payable_attachments(tenant_id,operating_company_id);
create index supplier_payable_attachments_created_by_idx on apticket.supplier_payable_attachments(created_by);
alter table apticket.supplier_payable_attachments enable row level security;
revoke all on apticket.supplier_payable_attachments from public,anon,authenticated,service_role;
grant select on apticket.supplier_payable_attachments to authenticated;
create policy supplier_payable_attachment_read on apticket.supplier_payable_attachments for select to authenticated
  using (apticket.has_permission(auth.uid(),'financeiro_contas_pagar','view')
    and apticket.has_financial_scope(tenant_id,operating_company_id));
create trigger audit_supplier_payable_attachment after insert on apticket.supplier_payable_attachments
  for each row execute function apticket_finance_private.audit_record();

insert into storage.buckets(id,name,public,file_size_limit)
values('supplier-payable-attachments','supplier-payable-attachments',false,10485760);

-- Definer is required here so an invisible linked attachment can never be deleted as a draft.
create function apticket_finance_private.can_manage_payable_upload(p_path text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select auth.uid() is not null and apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit')
    and exists(select 1 from apticket.operating_companies c
      where c.id::text=split_part(p_path,'/',2) and c.tenant_id::text=split_part(p_path,'/',1)
      and split_part(p_path,'/',3)=auth.uid()::text and c.deleted_at is null and c.is_active
      and apticket.has_financial_scope(c.tenant_id,c.id,true))
    and not exists(select 1 from apticket.supplier_payable_attachments a where a.storage_path=p_path);
$$;
revoke all on function apticket_finance_private.can_manage_payable_upload(text) from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.can_manage_payable_upload(text) to authenticated;

create policy supplier_payable_upload_insert on storage.objects for insert to authenticated
  with check(bucket_id='supplier-payable-attachments' and apticket_finance_private.can_manage_payable_upload(name));
create policy supplier_payable_upload_read on storage.objects for select to authenticated
  using(bucket_id='supplier-payable-attachments' and (
    apticket_finance_private.can_manage_payable_upload(name)
    or exists(select 1 from apticket.supplier_payable_attachments a where a.storage_path=name)));
create policy supplier_payable_upload_delete on storage.objects for delete to authenticated
  using(bucket_id='supplier-payable-attachments' and apticket_finance_private.can_manage_payable_upload(name));

create function apticket_finance_private.link_payable_attachments(p_group uuid,p_attachments jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare item jsonb; payable apticket.supplier_payables; obj storage.objects;
begin
  if auth.uid() is null or not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') then
    raise exception using errcode='42501',message='Sem permissão para incluir anexos.';
  end if;
  if p_attachments is null or jsonb_typeof(p_attachments)<>'array' then
    raise exception using errcode='22023',message='Informe uma lista válida de anexos.';
  end if;
  if jsonb_array_length(p_attachments)>20 then
    raise exception using errcode='22023',message='Inclua no máximo 20 anexos por lançamento.';
  end if;
  for item in select value from jsonb_array_elements(p_attachments) loop
    if jsonb_typeof(item)<>'object' or coalesce(item->>'installment_number','')!~'^[1-9][0-9]{0,2}$' then
      raise exception using errcode='22023',message='Selecione a parcela de cada anexo.';
    end if;
    select * into payable from apticket.supplier_payables
      where manual_entry_group_id=p_group and installment_number=(item->>'installment_number')::integer
      and tenant_id=apticket.current_tenant_id() and deleted_at is null for update;
    if not found or not apticket.has_financial_scope(payable.tenant_id,payable.operating_company_id,true) then
      raise exception using errcode='42501',message='Parcela indisponível para este anexo.';
    end if;
    if not apticket_finance_private.can_manage_payable_upload(item->>'storage_path')
      or split_part(item->>'storage_path','/',1)<>payable.tenant_id::text
      or split_part(item->>'storage_path','/',2)<>payable.operating_company_id::text then
      raise exception using errcode='42501',message='Arquivo indisponível para esta empresa.';
    end if;
    select * into obj from storage.objects where bucket_id='supplier-payable-attachments'
      and name=item->>'storage_path' for update;
    if not found then raise exception using errcode='23514',message='Envie o arquivo antes de salvar o anexo.'; end if;
    if coalesce(item->>'file_size','')!~'^[1-9][0-9]{0,7}$'
      or (item->>'file_size')::bigint is distinct from (obj.metadata->>'size')::bigint then
      raise exception using errcode='23514',message='O tamanho do anexo não corresponde ao arquivo enviado.';
    end if;
    insert into apticket.supplier_payable_attachments(tenant_id,operating_company_id,supplier_payable_id,
      storage_path,file_name,file_size,content_type,attachment_type,type_description,created_by)
    values(payable.tenant_id,payable.operating_company_id,payable.id,item->>'storage_path',
      btrim(item->>'file_name'),(item->>'file_size')::bigint,coalesce(obj.metadata->>'mimetype','application/octet-stream'),
      item->>'attachment_type',case when item->>'attachment_type'='outros' then nullif(btrim(item->>'type_description'),'') end,auth.uid());
  end loop;
end $$;
revoke all on function apticket_finance_private.link_payable_attachments(uuid,jsonb) from public,anon,authenticated,service_role;

create function apticket.create_manual_supplier_payable_with_attachments(
  p_operating_company_id uuid,p_supplier_id uuid,p_document_type_id uuid,
  p_document_number text,p_description text,p_competence date,p_total_amount numeric,
  p_installments jsonb,p_category_allocations jsonb,p_cost_center_allocations jsonb,
  p_attachments jsonb,p_installment_interval_days integer default 0,p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_group uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória.'; end if;
  -- Keep the original, validated creation flow and attach within its transaction.
  v_group:=apticket.create_manual_supplier_payable_allocated(p_operating_company_id,p_supplier_id,p_document_type_id,
    p_document_number,p_description,p_competence,p_total_amount,p_installments,p_category_allocations,
    p_cost_center_allocations,p_installment_interval_days,p_notes);
  perform apticket_finance_private.link_payable_attachments(v_group,p_attachments);
  return v_group;
end $$;
revoke all on function apticket.create_manual_supplier_payable_with_attachments(uuid,uuid,uuid,text,text,date,numeric,jsonb,jsonb,jsonb,jsonb,integer,text) from public,anon,authenticated,service_role;
grant execute on function apticket.create_manual_supplier_payable_with_attachments(uuid,uuid,uuid,text,text,date,numeric,jsonb,jsonb,jsonb,jsonb,integer,text) to authenticated;

create or replace function apticket.confirmar_previsao_conta_fixa(p_id uuid,p_expected_revision integer,p_payload jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare o apticket.fixed_payable_occurrences; v jsonb; v_group uuid; v_payable uuid; v_due date:=(p_payload->>'due_date')::date;
begin
  o:=apticket_finance_private.lock_fixed_occurrence(p_id,p_expected_revision);
  v:=apticket_finance_private.normalize_fixed_payload(o.tenant_id,o.operating_company_id,p_payload);
  v_group:=apticket.create_manual_supplier_payable_allocated(o.operating_company_id,(v->>'supplier_id')::uuid,(v->>'document_type_id')::uuid,
    p_payload->>'document_number',v->>'description',o.competence,(v->>'total_amount')::numeric,
    jsonb_build_array(jsonb_build_object('number',1,'due_date',v_due,'amount',(v->>'total_amount')::numeric)),v->'category_allocations',v->'cost_center_allocations',0,v->>'notes');
  perform apticket_finance_private.link_payable_attachments(v_group,coalesce(p_payload->'attachments','[]'::jsonb));
  select id into strict v_payable from apticket.supplier_payables where manual_entry_group_id=v_group;
  update apticket.fixed_payable_occurrences set status='confirmed',confirmed_payable_id=v_payable,confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),
    supplier_id=(v->>'supplier_id')::uuid,supplier_name=v->>'supplier_name',document_type_id=(v->>'document_type_id')::uuid,
    description=v->>'description',total_amount=(v->>'total_amount')::numeric,due_date=v_due,
    category_allocations=v->'category_allocations',cost_center_allocations=v->'cost_center_allocations',notes=v->>'notes' where id=o.id;
  return v_payable;
end $$;
notify pgrst,'reload schema';
