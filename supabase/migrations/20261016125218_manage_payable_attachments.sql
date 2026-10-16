-- Financial documents are removed logically; their audit trail and private files stay linked.
alter table apticket.supplier_payable_attachments
  add column deleted_at timestamptz,
  add column deleted_by uuid references apticket.profiles(id),
  add constraint payable_attachment_deletion_actor check ((deleted_at is null)=(deleted_by is null));
create index supplier_payable_attachments_deleted_by_idx on apticket.supplier_payable_attachments(deleted_by) where deleted_by is not null;

drop policy supplier_payable_attachment_read on apticket.supplier_payable_attachments;
create policy supplier_payable_attachment_read on apticket.supplier_payable_attachments for select to authenticated
  using (deleted_at is null and apticket.has_permission(auth.uid(),'financeiro_contas_pagar','view')
    and apticket.has_financial_scope(tenant_id,operating_company_id));
drop trigger audit_supplier_payable_attachment on apticket.supplier_payable_attachments;
create trigger audit_supplier_payable_attachment after insert or update on apticket.supplier_payable_attachments
  for each row execute function apticket_finance_private.audit_record();

create function apticket.add_supplier_payable_attachments(p_payable_id uuid,p_attachments jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p apticket.supplier_payables; item jsonb; obj storage.objects; v_count integer;
begin
  if auth.uid() is null or not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') then
    raise exception using errcode='42501',message='Sem permissão para incluir anexos.';
  end if;
  select * into p from apticket.supplier_payables where id=p_payable_id
    and tenant_id=apticket.current_tenant_id() and deleted_at is null for update;
  if not found or not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Lançamento indisponível nesta empresa.';
  end if;
  if p_attachments is null or jsonb_typeof(p_attachments)<>'array' then
    raise exception using errcode='22023',message='Informe uma lista válida de anexos.';
  end if;
  select count(*) into v_count from apticket.supplier_payable_attachments where supplier_payable_id=p.id and deleted_at is null;
  if jsonb_array_length(p_attachments)=0 or jsonb_array_length(p_attachments)+v_count>20 then
    raise exception using errcode='22023',message='Inclua ao menos um arquivo e mantenha no máximo 20 anexos no lançamento.';
  end if;
  for item in select value from jsonb_array_elements(p_attachments) loop
    if jsonb_typeof(item)<>'object' or coalesce(item->>'installment_number','')!~'^[1-9][0-9]{0,2}$'
      or (item->>'installment_number')::integer<>coalesce(p.installment_number,1) then
      raise exception using errcode='22023',message='O anexo deve pertencer à parcela selecionada.';
    end if;
    if not apticket_finance_private.can_manage_payable_upload(item->>'storage_path')
      or split_part(item->>'storage_path','/',1)<>p.tenant_id::text
      or split_part(item->>'storage_path','/',2)<>p.operating_company_id::text then
      raise exception using errcode='42501',message='Arquivo indisponível para esta empresa.';
    end if;
    select * into obj from storage.objects where bucket_id='supplier-payable-attachments' and name=item->>'storage_path' for update;
    if not found then raise exception using errcode='23514',message='Envie o arquivo antes de salvar o anexo.'; end if;
    if coalesce(item->>'file_size','')!~'^[1-9][0-9]{0,7}$'
      or (item->>'file_size')::bigint is distinct from (obj.metadata->>'size')::bigint then
      raise exception using errcode='23514',message='O tamanho do anexo não corresponde ao arquivo enviado.';
    end if;
    insert into apticket.supplier_payable_attachments(tenant_id,operating_company_id,supplier_payable_id,
      storage_path,file_name,file_size,content_type,attachment_type,type_description,created_by)
    values(p.tenant_id,p.operating_company_id,p.id,item->>'storage_path',btrim(item->>'file_name'),
      (item->>'file_size')::bigint,coalesce(obj.metadata->>'mimetype','application/octet-stream'),
      item->>'attachment_type',case when item->>'attachment_type'='outros' then nullif(btrim(item->>'type_description'),'') end,auth.uid());
  end loop;
  return true;
end $$;

create function apticket.remove_supplier_payable_attachment(p_payable_id uuid,p_attachment_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p apticket.supplier_payables; a apticket.supplier_payable_attachments;
begin
  if auth.uid() is null or not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') then
    raise exception using errcode='42501',message='Sem permissão para excluir anexos.';
  end if;
  -- Same lock order as inclusion, so the count and concurrent changes remain consistent.
  select * into p from apticket.supplier_payables where id=p_payable_id
    and tenant_id=apticket.current_tenant_id() and deleted_at is null for update;
  if not found or not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Lançamento indisponível nesta empresa.';
  end if;
  select * into a from apticket.supplier_payable_attachments where id=p_attachment_id
    and supplier_payable_id=p.id and tenant_id=p.tenant_id and operating_company_id=p.operating_company_id for update;
  if not found then raise exception using errcode='P0002',message='Anexo não encontrado neste lançamento.'; end if;
  if a.deleted_at is null then
    update apticket.supplier_payable_attachments set deleted_at=clock_timestamp(),deleted_by=auth.uid() where id=a.id;
  end if;
  return true;
end $$;

revoke all on function apticket.add_supplier_payable_attachments(uuid,jsonb),apticket.remove_supplier_payable_attachment(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function apticket.add_supplier_payable_attachments(uuid,jsonb),apticket.remove_supplier_payable_attachment(uuid,uuid) to authenticated;
comment on function apticket.add_supplier_payable_attachments(uuid,jsonb) is 'Inclui anexos tipados em um título existente, com limite por lançamento, escopo e validação do arquivo enviado. Não altera valores, status ou aprovações.';
comment on function apticket.remove_supplier_payable_attachment(uuid,uuid) is 'Retira um anexo do lançamento e do acesso normal ao Storage, preservando documento privado e auditoria.';
notify pgrst,'reload schema';
