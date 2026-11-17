# Inicialização e desligamento das conexões Redis

> Execução inline com diagnóstico, regressões antes das correções, validação e revisão independente. Base `0f8a496`; continuar na branch existente `codex/priority-session-whatsapp`.

**Objetivo:** evitar startup pendurado e conexões Pub/Sub órfãs; ativar desligamento Nest ordenado sem fechar o Redis compartilhado antes dos consumidores.

**Arquitetura:** adapter Socket.IO gerencia seus dois clientes, conexão lazy com orçamento conjunto de 5 s e cancelamento, dispose idempotente e desconexão imediata. Redis compartilhado encerra no hook final de aplicação, com QUIT limitado a 2 s. Bootstrap instala sinais SIGTERM/SIGINT e trata falhas com limpeza limitada e saída não zero. Shutdown normal preserva a espera de conclusão dos workers do Nest/BullMQ, limitado externamente pelo período de graça do container.

**Restrições:** preservar REDIS_URL/TLS/credenciais e reconexão de runtime; erros genéricos sem URL ou segredo. Nenhuma operação de produção, dependência nova do produto ou alteração de regras de cobrança/mensagens. Configuração URL BullMQ foi conferida no código instalado e já é suportada; não corrigir sem defeito.

## Tarefas

- [x] Reproduzir RED: dispose sem liberar Pub/Sub, startup sem deadline, chamadas duplicadas e fechamento prematuro do Redis compartilhado.
- [x] Implementar conexão/encerramento do adapter e utilitário de shutdown Redis limitado.
- [x] Integrar bootstrap seguro, sinais Nest e fase correta de encerramento; atualizar graça do compose.
- [x] Ensaios SDK/TCP/Nest locais e teste Redis/BullMQ real incluído no CI, com chaves/filas sintéticas e limpeza própria. Caminho positivo remoto pendente: Redis/Docker/WSL ausentes localmente.
- [x] Suíte API completa (172 testes/26 suítes), typecheck, build, lint e revisão independente; documentação concluída.
- [x] Diff conferido e entrega preparada para commit local, sem push/deploy.

## Evidências e limites

Dez regressões novas aprovadas; TCP/ioredis real e subprocessos Nest/entrypoint aprovados. Lint de segurança: zero erros e 140 warnings existentes. Prontidão e Lua anteriores reexecutadas com sucesso. Revisão independente sem Critical/Important; minor no ensaio CI corrigido para rejeitar saída inesperada no Linux após drain. O ensaio BullMQ sem Redis termina com erro limitado, sem pendurar; o teste positivo e o build Docker dependem de ambiente externo. Relatório: `docs/security/ciclo-vida-redis-20261117.md`.

## Casos de revisão

Falha após apenas um cliente conectar; dispose durante conexão; rejeição/resposta tardia; reconexão após falha; QUIT sem resposta; ordem de shutdown dos consumidores; configuração externa de graça; não transformar falha de startup em processo pendurado por conexões restantes.
