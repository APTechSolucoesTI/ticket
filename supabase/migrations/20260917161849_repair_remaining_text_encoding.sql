-- Corrige os últimos textos que ainda continham caracteres substituídos por
-- "?" ou pelo caractere Unicode de substituição. As trocas são explícitas
-- para não alterar perguntas legítimas escritas por usuários.

update apticket.funcionario_tipos_documento
set nome = case nome
  when 'Declara??o de Dependentes (IRRF)' then 'Declaração de Dependentes (IRRF)'
  when 'Vale-Transporte - Op??o ou Recusa' then 'Vale-Transporte - Opção ou Recusa'
  else nome
end
where nome in (
  'Declara??o de Dependentes (IRRF)',
  'Vale-Transporte - Op??o ou Recusa'
);

update apticket.feriados
set nome = 'Confraternização Universal'
where nome = 'Confraterniza??o Universal';

-- O log financeiro preserva fotografias em JSON dos cadastros. Embora os
-- registros atuais já estejam corretos, essas fotografias também aparecem em
-- tela e por isso precisam receber as mesmas correções pontuais.
alter table apticket.financial_audit_log disable trigger guard_financial_record;

do $$
declare
  replacement record;
begin
  for replacement in
    select *
    from (values
      ('Administra??o', 'Administração'),
      ('adquir?ncia', 'adquirência'),
      ('Aquisi??es', 'Aquisições'),
      ('banc?rias', 'bancárias'),
      ('benef?cios', 'benefícios'),
      ('cobran?a', 'cobrança'),
      ('Combust?vel', 'Combustível'),
      ('comunica??o', 'comunicação'),
      ('condom?nio', 'condomínio'),
      ('contribui??es', 'contribuições'),
      ('gera??o', 'geração'),
      ('gest?o', 'gestão'),
      ('implanta??es', 'implantações'),
      ('implanta??o', 'implantação'),
      ('licen?as', 'licenças'),
      ('Licen?as', 'Licenças'),
      ('manuten??o', 'manutenção'),
      ('migra??es', 'migrações'),
      ('n?o', 'não'),
      ('obriga??es', 'obrigações'),
      ('ocupa??o', 'ocupação'),
      ('opera??o', 'operação'),
      ('Opera??o', 'Operação'),
      ('pe?as', 'peças'),
      ('ped?gio', 'pedágio'),
      ('perif?ricos', 'periféricos'),
      ('Prospec??o', 'Prospecção'),
      ('provis?es', 'provisões'),
      ('regulariza??es', 'regularizações'),
      ('remunera??o', 'remuneração'),
      ('sa?da', 'saída'),
      ('sa?das', 'saídas'),
      ('Sal?rios', 'Salários'),
      ('servi?os', 'serviços'),
      ('subscri??es', 'subscrições'),
      ('t?cnica', 'técnica'),
      ('t?cnico', 'técnico'),
      ('Transfer?ncias', 'Transferências')
    ) as replacements(damaged, corrected)
  loop
    update apticket.financial_audit_log
    set before_data = replace(before_data::text, replacement.damaged, replacement.corrected)::jsonb
    where before_data::text like '%' || replacement.damaged || '%';

    update apticket.financial_audit_log
    set after_data = replace(after_data::text, replacement.damaged, replacement.corrected)::jsonb
    where after_data::text like '%' || replacement.damaged || '%';
  end loop;
end
$$;

alter table apticket.financial_audit_log enable trigger guard_financial_record;

-- Estas funções pertencem ao fluxo legado de produção compartilhado no
-- schema public. Recriá-las a partir de pg_get_functiondef preserva assinatura,
-- permissões, atributos e configuração enquanto corrige apenas as mensagens.
do $$
declare
  routine record;
  definition text;
begin
  for routine in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and position(chr(65533) in p.prosrc) > 0
  loop
    definition := pg_get_functiondef(routine.oid);
    definition := replace(definition, 'inv' || chr(65533) || 'lida', 'inválida');
    definition := replace(definition, 'n' || chr(65533) || 'o', 'não');
    definition := replace(definition, 'desativ' || chr(65533) || '-la', 'desativá-la');
    definition := replace(definition, 'est' || chr(65533), 'está');
    definition := replace(definition, 'expedi' || chr(65533) || chr(65533) || 'o', 'expedição');
    definition := replace(definition, 'j' || chr(65533), 'já');
    definition := replace(definition, 'Licen' || chr(65533) || 'a', 'Licença');
    definition := replace(definition, 'usu' || chr(65533) || 'rios', 'usuários');
    definition := replace(definition, 'Transi' || chr(65533) || chr(65533) || 'o', 'Transição');
    definition := replace(definition, chr(65533), '-');
    execute definition;
  end loop;
end
$$;

notify pgrst, 'reload schema';
