-- A edicao direta de funcionarios e autorizada por RLS, mas o trigger roda
-- como authenticated e chama validate_cpf() no schema privado. Como esse
-- schema nao e acessivel pela API (por design), a chamada falha com 42501.
--
-- O trigger permanece sem EXECUTE para os papeis da API e com search_path
-- fixo. SECURITY DEFINER permite somente que a execucao interna do trigger
-- alcance o validador privado; RLS continua controlando quais linhas podem ser
-- atualizadas.
alter function apticket_hr_private.prepare_employee() security definer;

revoke all on function apticket_hr_private.prepare_employee()
from public, anon, authenticated, service_role;

comment on function apticket_hr_private.prepare_employee() is
  'Normaliza e valida funcionarios em trigger; executa como owner para acessar validadores privados.';
