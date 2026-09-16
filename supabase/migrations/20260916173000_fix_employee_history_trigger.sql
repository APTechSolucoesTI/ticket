-- Corrige o trigger polimórfico: campos NEW inexistentes não podem ser
-- referenciados diretamente em triggers compartilhados entre tabelas.
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
