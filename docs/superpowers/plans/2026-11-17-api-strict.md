# API TypeScript estrito — plano de implementação

**Objetivo:** concluir a pendência de checagem estrita da API antes da publicação, preservando comportamento de runtime.

**Arquitetura e desenho:** manter a configuração única em `apps/api/tsconfig.json`, herdada pelo build e pelo Jest/ts-jest. Ativar `strict` e `noFallthroughCasesInSwitch`; remover os overrides que desabilitavam `noImplicitAny` e `strictBindCallApply`. O CI já executa typecheck API, Jest e build.

**Alternativas avaliadas:** endurecimento gradual por opção ou ativação completa. A compilação diagnóstica com `--strict --noImplicitAny true --strictBindCallApply true --noFallthroughCasesInSwitch true` passou sem erros; portanto a ativação completa atende ao pedido de ajustes simples. `noUncheckedIndexedAccess`, migração de `any` explícito e schemas adicionais são trabalhos separados, sem alegar que `strict` os resolve.

**Escopo autorizado:** usuário priorizou correções médias simples antes de publicar; execução inline na branch existente, sem push/deploy/migration/acesso à produção. Nenhum recurso, dependência ou regra de negócio novo. Coleta de órfãos e índices com distribuição real ficam para lotes próprios.

## Etapas

- [x] Diagnosticar a configuração atual e compilar com as opções propostas; zero erros, sem precisar refatorar código de domínio.
- [x] Ativar a configuração compartilhada; comprovar flags efetivas e rejeição de exemplos inválidos pelo compilador real.
- [x] Executar typecheck, 26 suítes API (172 testes), lint API/segurança e build; todos com exit 0. Segurança conserva 140 warnings existentes e nenhum erro.
- [x] Revisão independente do diff e dos limites declarados; nenhum achado Critical/Important/Minor. Confirmadas flags efetivas nas configurações padrão/build e inclusão dos testes no typecheck.
- [x] Atualizar documentação da arquitetura e relatório; entrega preparada para commit local após diff/checks, sem push/deploy.

## Verificação e limites

O compilador é a verificação adequada a esta mudança de configuração. Ensaios efêmeros exercitarão inferência implícita indevida, null, call/bind e fallthrough com as opções efetivas; não se adiciona teste permanente que apenas espelha valores JSON. Os testes existentes conferem regressões de runtime e a compilação pelo ts-jest. Não alegar eliminação de `any` explícito nem validação automática de payloads externos.

**Precisão da revisão:** com `isolatedModules: true`, ts-jest transpila os testes; o `tsc --noEmit` separado garante a checagem semântica. O ensaio efêmero efetivamente cobriu cinco diagnósticos (7006, 2345, 7029, 2564 e 18046) e casos válidos, sem criar arquivos de fixtures no produto. O `showConfig` do build confirmou as opções estritas herdadas. O resultado é configuração mais rigorosa, sem atribuir ao compilador validação de dados externos em runtime.
