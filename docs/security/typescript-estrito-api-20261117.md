# TypeScript estrito da API

Data: 17/11/2026. Base: `c72ff26`, branch local `codex/priority-session-whatsapp`.

## 1. Stack Tecnológica & Ecossistema

Mantidos TypeScript, NestJS e ts-jest já instalados, sem dependências novas. A fonte de verdade é `apps/api/tsconfig.json`; `tsconfig.build.json` herda suas opções.

## 2. Infraestrutura & Deploy

Mudança de checagem estática, sem alteração de runtime, migration, variável de ambiente ou infraestrutura. O CI existente já executa `pnpm --filter api exec tsc --noEmit`, Jest e build; nenhuma etapa adicional foi necessária.

Nenhum push, publicação ou acesso à produção realizado neste lote. As migrations e validações operacionais das entregas anteriores continuam pendentes antes da publicação acumulada.

## 3. Arquitetura & Conceitos de Domínio

Ativado `strict: true` e removidos os overrides `noImplicitAny: false` e `strictBindCallApply: false`. `strictNullChecks` passa a ser herdado de `strict`, mantendo sua proteção. Ativado também `noFallthroughCasesInSwitch: true`.

Assim, a configuração padrão abrange checagem de parâmetros implícitos, callbacks, inicialização de propriedades, `this`, variáveis capturadas em `catch` e demais opções de `strict` da versão instalada. São verificações do compilador; nenhuma entidade, consulta, contrato HTTP ou regra de negócio mudou.

## 4. Inventário de Funcionalidades (Features)

| Área | Resultado |
|---|---|
| Código de produção | Compila sob a configuração estrita herdada pelo build |
| Testes API | Checados pelo typecheck e compilados pelo ts-jest com as mesmas regras |
| Switch | Casos não vazios que caem no próximo caso são rejeitados |
| Documentação | Pendência antiga de configuração permissiva atualizada na arquitetura |

## 5. Code Quality & Technical Debt (Bônus Técnico)

O diagnóstico com `--strict --noImplicitAny true --strictBindCallApply true --noFallthroughCasesInSwitch true` passou antes da edição: não foi necessário refatorar código de domínio para ativar essas proteções.

Um ensaio efêmero com o compilador TypeScript real e as opções efetivas demonstrou cinco exemplos aceitos pela configuração anterior e rejeitados pela nova: parâmetro com `any` implícito (7006), argumento incompatível em `call` (2345), fallthrough de switch (7029), propriedade não inicializada (2564) e acesso inseguro a erro `unknown` no catch (18046). Exemplos corrigidos foram aceitos. O ensaio ficou no diretório ignorado `node_modules`; não foi adicionado teste permanente que apenas duplica a configuração JSON.

Typecheck, **172 testes API em 26 suítes**, lint API, lint de segurança e build aprovados com a nova configuração. Segurança conserva 140 warnings existentes e nenhum erro. Evidências registradas no plano desta entrega: `docs/superpowers/plans/2026-11-17-api-strict.md`.

Revisão independente sem achados críticos, importantes ou menores. Com `isolatedModules: true`, ts-jest transpila os testes; a checagem semântica é garantida pelo `tsc` separado, também presente no CI.

Reprodução:

```powershell
pnpm --filter api exec tsc --noEmit
pnpm --filter api exec jest --runInBand
pnpm --filter api exec eslint 'src/**/*.ts' 'test/**/*.ts'
pnpm --filter api build
pnpm lint:security
```

Limites: `strict` não proíbe `any` explícito ou type assertions e não valida payloads de rede em runtime. `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes` não fazem parte deste lote. Limpeza de arquivos órfãos e otimização de SQL exigem investigação própria; não foram executadas exclusões ou criados índices por suposição.
