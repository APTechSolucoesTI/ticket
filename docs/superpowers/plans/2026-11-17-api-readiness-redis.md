# Prontidão da API e expiração do limitador Redis

> Execução inline: diagnóstico, TDD, verificação antes da conclusão e revisão independente. Continuação autorizada na branch `codex/priority-session-whatsapp`, base `86e7f50`.

**Objetivo:** remover a janela entre incremento/expiração do limite de requisições e fornecer prontidão verificável para Redis e PostgREST, sem confundir esse sinal com liveness ou entrega de jobs.

**Arquitetura:** Lua Redis atômico para contador/TTL; validação de configuração e resposta. `/health` mantém o contrato de processo ativo. `/health/ready` público devolve 200/503 com estados genéricos, consultas paralelas, deadline de 2 s, cache/coalescência de 1 s, sem ler registros de negócio. Redis probe usa conexão isolada encerrada ao fim/timeout; PostgREST usa HEAD com limite zero e AbortSignal. Docker/compose usam prontidão.

**Restrições:** nenhuma chave real em testes/logs, nenhuma conexão/mudança de produção, sem novas dependências do produto, sem chamar provedores externos de mensagens/pagamentos para healthcheck. Não afirmar processamento de filas a partir de PING ou disponibilidade do banco.

## Task 1 — limitador

- [x] RED com contador persistente sem TTL, TTL zero e falha parcial; parâmetros/respostas inválidos recusados.
- [x] Implementar script único INCR/TTL/EXPIRE, recuperando chaves legadas sem expiração sem renovar janelas válidas.
- [x] Testar Lua real localmente com runtime isolado, e adicionar ensaio Redis real no CI com namespace sintético e cleanup próprio.

## Task 2 — prontidão

- [x] RED: HTTP atual não distingue dependências indisponíveis; testes de estado, deadline, coalescência e sanitização.
- [x] Implementar service/controller de prontidão com probes canceláveis e conexões isoladas.
- [x] Docker/compose, configuração de CI e documentação operacional coerentes.
- [x] Jest completo, typecheck, build, lint, HTTP/protocolos locais e revisão independente; limites registrados e entrega em commit local.

## Revisão

Verificar offline queue Redis, comandos pendentes após timeout, cache que oculta recuperação, respostas com erros/segredos, efeito em liveness e ausência de leituras/escritas de negócio no probe.

## Resultados

- 162 testes/23 suítes; build, typecheck e lint API aprovados. Lint de segurança sem erros.
- Revisão encontrou socket aberto por mais 2 s após deadline e renovação indevida de contador zero. Ambos reproduzidos por SDK/Lua reais antes da correção; ensaios passaram depois.
- SDKs reais contra HTTP/TCP locais comprovaram HEAD sem linhas, cancelamento e comando do Docker para 200/503/timeout.
- Revisão final sem achados Critical/Important. Redis real é ensaio configurado no CI, não executado neste Windows. Nenhuma operação de produção.
- [Relatório e publicação](../../security/prontidao-api-redis-20261117.md).
