# Cadastro e chat transacionais

**Objetivo:** impedir tenant sem proprietário e ticket de chat sem mensagem inicial.
**Base:** `9d30b38`; continuar na branch local existente.
**Abordagem:** duas RPCs SQL `SECURITY INVOKER`, com execução restrita a `service_role`, migração incremental e rollback. Os endpoints continuam responsáveis pelo rate limit, validação e comprovação da identidade.

## Decisões

- Provisionamento cria tenant, defaults via triggers, perfil com hash bcrypt e vínculo Admin na mesma transação. O banco gera os IDs e o slug.
- Chat revalida contato, tenant, cliente e contrato no banco; cria ticket e mensagem na mesma transação. Contrato explicitamente inválido é rejeitado.
- Usar locks de leitura nas entidades autorizadoras para impedir alteração concorrente durante a criação do chat.
- Não compensar falhas com deletes em chamadas posteriores: a transação deve fazer rollback.
- Preparar implantação migration-first; não modificar produção nesta entrega.
- Testar com dados sintéticos no PostgreSQL 17.6 local. O teste local usa DDL extraído do snapshot existente; o teste SQL também entra na suíte completa de CI.

## Tarefas

- [x] Adicionar regressões HTTP que falhem no fluxo atual.
- [x] Adicionar testes SQL de rollback, autorização, contrato e duplicidade.
- [x] Implementar migração e rollback; validar no PostgreSQL descartável.
- [x] Adaptar server function de cadastro, endpoint do portal e tipos compartilhados.
- [x] Executar testes API/sessão/HTTP, typechecks, lint e builds aplicáveis.
- [x] Revisão independente e documentação; commit local após verificação final.

## Critérios

- Falhas no perfil/papel não deixam tenant nem defaults parciais.
- E-mails duplicados, inclusive concorrentes, não criam tenants órfãos.
- Falha na mensagem desfaz o ticket e seus efeitos transacionais.
- Contato inativo/bloqueado, tenant estrangeiro e contrato inválido são recusados.
- Browser não pode executar as RPCs privilegiadas.
- Não retornar credenciais ou erros internos ao cliente.

## Registro

- RED HTTP: tenant persistido após falha de perfil; chat retornando 201 após falha de mensagem.
- GREEN PostgreSQL 17.6: teste SQL, rollback/reaplicação, duplicidade concorrente e bloqueios de contato/contrato.
- Revisão independente encontrou substituição do contrato pelo trigger legado. O teste com o trigger real reproduziu P0004 antes da correção.
- Decisão: corrigir o ramo de classificação de chat sem equipamento e conferir o contrato efetivamente persistido; manter o resolver anterior para outros canais/equipamentos. Custo: esse ramo passa a recusar seleção de contrato inválido, em vez de substituí-la silenciosamente.
- Verificações Node22: 144/144 testes API, 8/8 sessão, typechecks e build web, testes HTTP e lint dos arquivos alterados aprovados. Security lint sem erros; warnings e CRLF global permanecem documentados.
- O ensaio local usa DDL/triggers relevantes extraídos do snapshot, sem afirmar que substitui o job SQL completo do CI.
- Implantação migration-first documentada em `docs/security/fluxos-transacionais-20261117.md`; produção não alterada.
