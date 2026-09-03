begin;

-- Regrava a RPC para corrigir os literais que foram publicados com dupla
-- codificação UTF-8 no ambiente hospedado.
create or replace function apticket.aprovar_medicao_contrato(p_medicao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, apticket
as $$
declare
  v_tenant_id uuid := apticket.current_tenant_id();
  v_medicao apticket.medicoes_contrato;
  v_actor_nome text;
  v_company_id uuid;
  v_conta_id uuid;
  v_ja_aprovada boolean := false;
begin
  if auth.uid() is null
    or v_tenant_id is null
    or not apticket.has_permission(auth.uid(), 'contratos', 'edit') then
    raise exception using errcode = '42501', message = 'Sem permissão para aprovar a medição.';
  end if;

  select profile.name into v_actor_nome
  from apticket.profiles as profile
  where profile.id = auth.uid()
    and profile.tenant_id = v_tenant_id
    and profile.is_active;

  if v_actor_nome is null then
    raise exception using errcode = '42501', message = 'Usuário ativo não encontrado.';
  end if;

  select * into v_medicao
  from apticket.medicoes_contrato
  where id = p_medicao_id
    and tenant_id = v_tenant_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Medição não encontrada.';
  end if;

  if v_medicao.status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Uma medição cancelada não pode ser aprovada.';
  elsif v_medicao.status = 'faturada' then
    raise exception using errcode = '22023', message = 'Uma medição faturada não pode ser aprovada novamente.';
  elsif v_medicao.status = 'aprovada' then
    v_ja_aprovada := true;
  elsif v_medicao.status <> 'gerada' then
    raise exception using errcode = '22023', message = 'A medição não está disponível para aprovação.';
  else
    update apticket.medicoes_contrato
    set status = 'aprovada',
        aprovada_em = now(),
        aprovada_por = auth.uid(),
        aprovada_por_nome = v_actor_nome
    where id = p_medicao_id
    returning * into v_medicao;
  end if;

  select company_id into v_company_id
  from apticket.contracts
  where id = v_medicao.contrato_id
    and tenant_id = v_tenant_id;

  if v_company_id is null then
    raise exception using errcode = 'P0002', message = 'Cliente do contrato não encontrado.';
  end if;

  insert into apticket.contas_receber (
    tenant_id, medicao_id, contrato_id, company_id, cliente_nome,
    documento_referencia, descricao, competencia, valor_original,
    valor_aberto, vencimento_em, aprovado_em, aprovado_por
  ) values (
    v_tenant_id,
    v_medicao.id,
    v_medicao.contrato_id,
    v_company_id,
    v_medicao.cliente_nome,
    'MED-' || replace(v_medicao.numero_contrato, '/', '-') || '-' || to_char(v_medicao.competencia, 'YYYYMM'),
    'Medição do contrato ' || v_medicao.numero_contrato || ' - competência ' || to_char(v_medicao.competencia, 'MM/YYYY'),
    v_medicao.competencia,
    v_medicao.valor_total,
    v_medicao.valor_total,
    v_medicao.data_vencimento,
    coalesce(v_medicao.aprovada_em, now()),
    coalesce(v_medicao.aprovada_por, auth.uid())
  )
  on conflict (medicao_id) do nothing
  returning id into v_conta_id;

  if v_conta_id is null then
    select id into v_conta_id
    from apticket.contas_receber
    where medicao_id = v_medicao.id;
  end if;

  return jsonb_build_object(
    'medicao_id', v_medicao.id,
    'conta_receber_id', v_conta_id,
    'status', 'aprovada',
    'ja_aprovada', v_ja_aprovada
  );
end
$$;

revoke all on function apticket.aprovar_medicao_contrato(uuid) from public, anon;
grant execute on function apticket.aprovar_medicao_contrato(uuid) to authenticated, service_role;

-- A descrição é um snapshot protegido. A migration suspende somente o trigger
-- dessa tabela durante a reconstrução determinística a partir da medição.
alter table apticket.contas_receber disable trigger contas_receber_proteger_alteracao;

update apticket.contas_receber as conta
set descricao = 'Medição do contrato ' || medicao.numero_contrato
  || ' - competência ' || to_char(medicao.competencia, 'MM/YYYY'),
    updated_at = now()
from apticket.medicoes_contrato as medicao
where medicao.id = conta.medicao_id
  and conta.deleted_at is null;

alter table apticket.contas_receber enable trigger contas_receber_proteger_alteracao;

commit;
