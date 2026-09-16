alter table apticket.funcionarios alter column pis_pasep drop not null;
alter table apticket.funcionarios alter column ctps_uf drop not null;

create or replace function apticket.update_employee_position(
  p_position_id uuid,p_cargo text,p_nivel text,p_salario numeric,p_tipo_alteracao text,
  p_motivo text,p_vigente_de date,p_vigente_ate date default null
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare position apticket.funcionario_cargos_salarios; begin
  select * into position from apticket.funcionario_cargos_salarios where id=p_position_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Cargo e salário não encontrados.'; end if;
  if auth.uid() is null or position.tenant_id<>apticket.current_tenant_id()
    or not apticket.has_permission(auth.uid(),'funcionarios','edit') then
    raise exception using errcode='42501',message='Sem permissão para editar cargos e salários.';
  end if;
  if length(btrim(coalesce(p_cargo,'')))<2 or p_salario<0 or p_vigente_de is null
    or (p_vigente_ate is not null and p_vigente_ate<p_vigente_de) then
    raise exception using errcode='23514',message='Revise cargo, salário e período de vigência.';
  end if;
  if p_tipo_alteracao not in ('admissao','promocao','merito','equiparacao','reducao_acordo','reajuste_coletivo') then
    raise exception using errcode='23514',message='Tipo de alteração inválido.';
  end if;
  if p_vigente_ate is null and position.vigente_ate is not null and exists(
    select 1 from apticket.funcionario_cargos_salarios other where other.funcionario_id=position.funcionario_id
      and other.id<>position.id and other.vigente_ate is null and other.deleted_at is null) then
    raise exception using errcode='23505',message='Já existe outro cargo e salário vigente. Informe a data final deste registro.';
  end if;
  update apticket.funcionario_cargos_salarios set cargo=btrim(p_cargo),nivel=nullif(btrim(p_nivel),''),
    salario_base=p_salario,tipo_alteracao=p_tipo_alteracao,motivo=nullif(btrim(p_motivo),''),
    vigente_de=p_vigente_de,vigente_ate=p_vigente_ate,updated_at=clock_timestamp() where id=p_position_id;
  if p_vigente_ate is null then
    update apticket.funcionarios set cargo_atual_id=p_position_id,updated_at=clock_timestamp(),updated_by=auth.uid()
      where id=position.funcionario_id;
  elsif exists(select 1 from apticket.funcionarios where id=position.funcionario_id and cargo_atual_id=p_position_id) then
    update apticket.funcionarios employee set cargo_atual_id=(select id from apticket.funcionario_cargos_salarios other
      where other.funcionario_id=position.funcionario_id and other.id<>position.id and other.vigente_ate is null
        and other.deleted_at is null order by other.vigente_de desc limit 1),updated_at=clock_timestamp(),updated_by=auth.uid()
      where employee.id=position.funcionario_id;
  end if;
end $$;

create or replace function apticket.archive_employee_position(p_position_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare position apticket.funcionario_cargos_salarios; replacement apticket.funcionario_cargos_salarios; begin
  select * into position from apticket.funcionario_cargos_salarios where id=p_position_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Cargo e salário não encontrados.'; end if;
  if auth.uid() is null or position.tenant_id<>apticket.current_tenant_id()
    or not apticket.has_permission(auth.uid(),'funcionarios','delete') then
    raise exception using errcode='42501',message='Sem permissão para excluir cargos e salários.';
  end if;
  update apticket.funcionario_cargos_salarios set deleted_at=clock_timestamp(),updated_at=clock_timestamp() where id=position.id;
  if position.vigente_ate is null then
    select * into replacement from apticket.funcionario_cargos_salarios
      where funcionario_id=position.funcionario_id and deleted_at is null order by vigente_de desc,created_at desc limit 1 for update;
    if replacement.id is null then
      update apticket.funcionarios set cargo_atual_id=null,updated_at=clock_timestamp(),updated_by=auth.uid() where id=position.funcionario_id;
    else
      update apticket.funcionario_cargos_salarios set vigente_ate=null,updated_at=clock_timestamp() where id=replacement.id;
      update apticket.funcionarios set cargo_atual_id=replacement.id,updated_at=clock_timestamp(),updated_by=auth.uid() where id=position.funcionario_id;
    end if;
  end if;
end $$;

revoke all on function apticket.update_employee_position(uuid,text,text,numeric,text,text,date,date),apticket.archive_employee_position(uuid) from public,anon,service_role;
grant execute on function apticket.update_employee_position(uuid,text,text,numeric,text,text,date,date),apticket.archive_employee_position(uuid) to authenticated;
notify pgrst,'reload schema';
