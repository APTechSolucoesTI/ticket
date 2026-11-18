# Primeira entrega de melhorias prioritárias

Data: 17/11/2026. Base: `6f799bed`. Branch: `codex/priority-session-whatsapp`.

## Alterações

### Isolamento de sessão

Mudanças de usuário ou tenant cancelam consultas, limpam o cache anterior e criam um QueryClient próprio para a nova identidade. A árvore de consumidores é remontada para descartar estado local e observers antigos. Renovação do token da mesma identidade preserva o cache.

A troca de sessão em outra aba também é observada. Callbacks tardios de mutations podem terminar, mas ficam vinculados ao QueryClient anterior e não restauram dados na sessão nova.

### Ingestão WhatsApp

Uma entrega só é reconhecida como duplicata quando já existe mensagem ou pendência persistida. Uma reserva Redis em andamento produz erro recuperável, sem confirmação falsa de persistência.

A reserva possui identificador de ownership; a liberação usa comparação e remoção atômicas. Falhas de gravação de mensagem ou pendência propagam erro para o BullMQ e liberam somente a reserva adquirida pelo processamento.

Consultas de existência usam `limit(1)` para tolerar duplicatas históricas. Cada tentativa de upload possui um caminho próprio, evitando colisão com arquivos enviados antes de uma falha de persistência.

## Evidências de regressão

- Oito cenários de sessão com AuthProvider, React, DOM e QueryClient reais: logout, troca de conta, troca de tenant, resposta atrasada, renovação, outra aba, HTTP 401 e rollback tardio de mutation.
- Doze cenários de ingestão: persistência, pendências, lookup indisponível, duplicatas duráveis/históricas, ownership, limpeza indisponível e mídia em retry.
- Os defeitos foram reproduzidos antes das respectivas correções.
- A regressão de sessão foi adicionada ao workflow de CI; os testes de ingestão entram na suíte Jest existente.

## Limites e operação

- Nenhum schema, dado, serviço ou configuração de produção foi alterado.
- Os adaptadores externos de banco, Redis, rede e Storage são sintéticos nos testes de ingestão. Não foi executado ensaio com provedores reais.
- Arquivos enviados antes de uma gravação malsucedida podem ficar órfãos. A coleta não fazia parte desta primeira entrega; a [reconciliação posterior](./reconciliacao-storage-20261118.md) implementa auditoria e coleta explícita protegida por vínculos/claims para `ticket-attachments`, sem operação real executada.
- O TTL de seis horas permanece. Crash do processo e indisponibilidade da limpeza Redis ainda requerem acompanhamento da fila; não há promessa de exactly-once.
- O lint web padrão falha por CRLF preexistente no checkout Windows. O lint completo com `endOfLine: auto` passou sem erros, preservando dez warnings existentes de Fast Refresh.
- Cadastro transacional e paginação foram corrigidos nas entregas posteriores documentadas; bootstrap/validações do ambiente e observabilidade continuam no acompanhamento operacional.

## Verificações finais

Resultados e versões de runtime são registrados no plano em `docs/superpowers/plans/2026-11-17-priority-session-whatsapp.md`.
