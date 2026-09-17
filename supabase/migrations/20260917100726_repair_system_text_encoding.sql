-- Repara textos que foram executados com uma conversao incorreta entre UTF-8
-- e a pagina de codigo do cliente. O dano substituiu caracteres acentuados
-- por "?" ou pelo caractere de substituicao e, portanto, precisa ser corrigido
-- na origem em vez de ser mascarado na interface.

update apticket.funcionario_tipos_documento
set nome = case nome
  when 'Comprovante de Resid?ncia' then 'Comprovante de Residência'
  when 'T?tulo de Eleitor' then 'Título de Eleitor'
  when 'Termo de Rescis?o (TRCT)' then 'Termo de Rescisão (TRCT)'
  when 'Dados Banc?rios - Comprovante' then 'Dados Bancários - Comprovante'
  when 'Certid?o de Casamento ou Nascimento de Dependentes'
    then 'Certidão de Casamento ou Nascimento de Dependentes'
  else nome
end
where nome in (
  'Comprovante de Resid?ncia',
  'T?tulo de Eleitor',
  'Termo de Rescis?o (TRCT)',
  'Dados Banc?rios - Comprovante',
  'Certid?o de Casamento ou Nascimento de Dependentes'
);

update apticket.feriados
set nome = case nome
  when 'Dia Nacional de Zumbi e da Consci?ncia Negra'
    then 'Dia Nacional de Zumbi e da Consciência Negra'
  when 'Independ?ncia do Brasil' then 'Independência do Brasil'
  when 'Paix?o de Cristo' then 'Paixão de Cristo'
  when 'Proclama??o da Rep?blica' then 'Proclamação da República'
  else nome
end
where nome in (
  'Dia Nacional de Zumbi e da Consci?ncia Negra',
  'Independ?ncia do Brasil',
  'Paix?o de Cristo',
  'Proclama??o da Rep?blica'
);

-- Estes registros pertencem ao fluxo legado de producao ainda mantido no
-- schema public e tambem sao exibidos para usuarios do APTicket.
update public.etapas_kanban
set nome = case id
  when '342ec294-843a-4621-8c2a-1642a579b436'::uuid then 'Pré-tratamento'
  when '356f440f-9493-453e-a382-8862d8bad2a6'::uuid then 'Aplicação de pó'
  when '96835368-fe26-49a7-a51a-ff7a95d4542f'::uuid then 'Cura a forno'
  else nome
end
where id in (
  '342ec294-843a-4621-8c2a-1642a579b436'::uuid,
  '356f440f-9493-453e-a382-8862d8bad2a6'::uuid,
  '96835368-fe26-49a7-a51a-ff7a95d4542f'::uuid
);

-- Reconstroi somente rotinas do APTicket cujo corpo contem palavras
-- comprovadamente corrompidas. pg_get_functiondef preserva assinatura,
-- atributos de seguranca e configuracoes de cada rotina.
do $$
declare
  routine record;
  definition text;
begin
  for routine in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('apticket', 'apticket_hr_private', 'apticket_finance_private')
      and p.prokind in ('f', 'p')
      and p.prosrc ~ '[[:alnum:]][?]+[[:alnum:]]'
  loop
    definition := pg_get_functiondef(routine.oid);

    definition := replace(definition, 'Confirma????o', 'Confirmação');
    definition := replace(definition, 'classifica????o', 'classificação');
    definition := replace(definition, 'configura????o', 'configuração');
    definition := replace(definition, 'confirma????o', 'confirmação');
    definition := replace(definition, 'execu????o', 'execução');
    definition := replace(definition, 'importa????o', 'importação');
    definition := replace(definition, 'observa????es', 'observações');
    definition := replace(definition, 'produ????o', 'produção');
    definition := replace(definition, 'solicita????o', 'solicitação');

    definition := replace(definition, 'Emiss??o', 'Emissão');
    definition := replace(definition, 'Lan??amento', 'Lançamento');
    definition := replace(definition, 'Medi??o', 'Medição');
    definition := replace(definition, 'N??o', 'Não');
    definition := replace(definition, 'Usu??rio', 'Usuário');
    definition := replace(definition, 'Vale-refei??o', 'Vale-refeição');
    definition := replace(definition, 'altera??o', 'alteração');
    definition := replace(definition, 'banc??ria', 'bancária');
    definition := replace(definition, 'banc??rias', 'bancárias');
    definition := replace(definition, 'banc??rio', 'bancário');
    definition := replace(definition, 'c??digo', 'código');
    definition := replace(definition, 'classifica??o', 'classificação');
    definition := replace(definition, 'configura??o', 'configuração');
    definition := replace(definition, 'confirma??o', 'confirmação');
    definition := replace(definition, 'cont??m', 'contém');
    definition := replace(definition, 'd??gitos', 'dígitos');
    definition := replace(definition, 'dispon??vel', 'disponível');
    definition := replace(definition, 'est??', 'está');
    definition := replace(definition, 'exclus??o', 'exclusão');
    definition := replace(definition, 'expl??cita', 'explícita');
    definition := replace(definition, 'f??sica', 'física');
    definition := replace(definition, 'imut??veis', 'imutáveis');
    definition := replace(definition, 'imut??vel', 'imutável');
    definition := replace(definition, 'indispon??vel', 'indisponível');
    definition := replace(definition, 'inv??lida', 'inválida');
    definition := replace(definition, 'inv??lido', 'inválido');
    definition := replace(definition, 'j??', 'já');
    definition := replace(definition, 'lan??amento', 'lançamento');
    definition := replace(definition, 'm??ximo', 'máximo');
    definition := replace(definition, 'medi??es', 'medições');
    definition := replace(definition, 'medi??o', 'medição');
    definition := replace(definition, 'n??o', 'não');
    definition := replace(definition, 'numera??o', 'numeração');
    definition := replace(definition, 'obrigat??ria', 'obrigatória');
    definition := replace(definition, 'or??amento', 'orçamento');
    definition := replace(definition, 'padr??o', 'padrão');
    definition := replace(definition, 'per??odo', 'período');
    definition := replace(definition, 'permiss??o', 'permissão');
    definition := replace(definition, 'respons??vel', 'responsável');
    definition := replace(definition, 's??o', 'são');
    definition := replace(definition, 'ser??', 'será');
    definition := replace(definition, 'tr??s', 'três');
    definition := replace(definition, 'v??lida', 'válida');
    definition := replace(definition, 'v??nculo', 'vínculo');

    definition := replace(definition, '13? sal?rio', '13º salário');
    definition := replace(definition, 'F?rias', 'Férias');
    definition := replace(definition, 'Funcion?rio', 'Funcionário');
    definition := replace(definition, 'J?', 'Já');
    definition := replace(definition, 'Servi?o', 'Serviço');
    definition := replace(definition, 'Sess??o', 'Sessão');
    definition := replace(definition, 'Sess?o', 'Sessão');
    definition := replace(definition, 'banc?rios', 'bancários');
    definition := replace(definition, 'cobran?a', 'cobrança');
    definition := replace(definition, 'compet??ncia', 'competência');
    definition := replace(definition, 'compet?ncia', 'competência');
    definition := replace(definition, 'est?', 'está');
    definition := replace(definition, 'funcion?rio', 'funcionário');
    definition := replace(definition, 'funcion?rios', 'funcionários');
    definition := replace(definition, 'hist?ricos', 'históricos');
    definition := replace(definition, 'inv?lida', 'inválida');
    definition := replace(definition, 'inv?lido', 'inválido');
    definition := replace(definition, 'm?dulo', 'módulo');
    definition := replace(definition, 'n?mero', 'número');
    definition := replace(definition, 'n?o', 'não');
    definition := replace(definition, 'padr?o', 'padrão');
    definition := replace(definition, 'per?odo', 'período');
    definition := replace(definition, 'permiss?o', 'permissão');
    definition := replace(definition, 'pre?o', 'preço');
    definition := replace(definition, 's?o', 'são');
    definition := replace(definition, 'sal?rio', 'salário');
    definition := replace(definition, 'sal?rios', 'salários');
    definition := replace(definition, 'sens?veis', 'sensíveis');
    definition := replace(definition, 'servi?o', 'serviço');
    definition := replace(definition, 'servi?os', 'serviços');
    definition := replace(definition, 'v?lida', 'válida');
    definition := replace(definition, 'v?lidos', 'válidos');
    definition := replace(definition, 'vig?ncia', 'vigência');

    execute definition;
  end loop;
end
$$;
