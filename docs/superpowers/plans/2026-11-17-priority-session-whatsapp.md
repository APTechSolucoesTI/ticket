# Isolamento de sessão e retry WhatsApp

**Objetivo:** corrigir os dois primeiros riscos de execução identificados na auditoria: reutilização de cache entre contas e supressão de mensagens após falha transitória.

**Base:** `6f799bed`, branch local `codex/priority-session-whatsapp`.

## Decisões de implementação

- Executar nesta sessão, em branch própria, preservando o checkout e sem alterar serviços publicados.
- Manter a stack e as dependências do lockfile.
- Cache: cancelar e limpar na mudança de usuário/tenant, criar um QueryClient novo e remontar consumidores. Callbacks de mutations antigas continuam vinculados ao client aposentado. Preservar o cache em renovação da mesma identidade e reagir à troca de sessão em outra aba.
- WhatsApp: a reserva de deduplicação pertence ao service que a adquire. Liberar somente a reserva do próprio processamento em qualquer falha, preservando o erro para retry. Manter deduplicação após persistência e conferência no banco.
- Usar dados sintéticos nos testes; não usar credenciais nem dados de produção.
- Mudanças de schema, bootstrap histórico e publicação ficam para entregas próprias.

## Alternativas consideradas

- Migrar imediatamente todas as query keys: maior superfície de alteração e não protege chaves legadas esquecidas. A limpeza central com remontagem protege essas chaves na primeira entrega.
- Apagar a chave Redis indiscriminadamente no processor: pode apagar uma reserva de outro processamento. A liberação deve comparar ownership atomicamente.

## Tarefas

- [x] Reproduzir o vazamento de cache com QueryClient real, incluindo consulta em voo e troca de tenant.
- [x] Implementar fronteira de sessão e testar logout, login, renovação e evento storage.
- [x] Reproduzir falha de persistência seguida de retry com service WhatsApp real e adaptadores externos sintéticos.
- [x] Implementar reserva Redis com ownership e liberação condicional, cobrindo concorrência e duplicata durável.
- [x] Executar testes unitários API, scripts de sessão, typecheck, lint e builds dos dois apps.
- [x] Revisar o diff e registrar limitações e verificações.

## Critérios de aceite

- Conta B nunca recebe dados em cache da conta A, mesmo usando a mesma query key.
- Resposta tardia da conta A não repopula o cache após logout.
- Renovação do token da mesma identidade não apaga dados úteis.
- Falha antes da persistência não impede a tentativa seguinte do WhatsApp.
- Um processamento não pode liberar a reserva de outro.
- Mensagens já persistidas continuam deduplicadas.

## Verificação

- Scripts Node de sessão/cache com dados sintéticos e QueryClient real.
- Jest da API, incluindo novas regressões de ingestão e ownership.
- `pnpm --filter web exec tsc --noEmit`, `pnpm --filter api exec tsc --noEmit`.
- Lint sem `--fix`, builds web/API e scripts de segurança aplicáveis.

## Registro de execução

- Checkout inicialmente limpo. Node e Git encontrados fora do PATH; usar executáveis instalados explicitamente.
- Nenhuma conexão ao servidor ou alteração de produção necessária para reproduzir estes dois defeitos.
- Baseline: 132 testes da API aprovados; seis regressões iniciais de cache e quatro de ingestão reproduziram falhas antes das correções.
- Revisão independente apontou rollback tardio de mutation, colisão de anexo em retry e duplicatas históricas nas consultas de existência. Todos foram reproduzidos por testes antes da correção.
- Decisão: criar caminhos de upload distintos por tentativa. Isso permite retry sem apagar objetos cujo vínculo ao banco pode ter resultado incerto. Custo: objetos órfãos precisam de coleta posterior; esta entrega não apaga arquivos existentes.
- Decisão: manter o TTL de seis horas da reserva. Exceções liberam apenas a reserva do próprio processamento; falha abrupta do processo ou indisponibilidade do Redis ainda pode exigir tratamento da fila após expiração. Não é uma garantia de entrega exactly-once.
- Lint web padrão encontrou CRLF nos arquivos originais. A checagem completa aceitando o estilo de fim de linha do checkout passou sem erros, com dez warnings. Nenhuma normalização em massa foi aplicada.

## Resultado final

- Runtime de confirmação: Node **22.23.5**, obtido como ferramenta temporária sem mudar o lockfile do projeto. As verificações iniciais também rodaram com o Node 26 instalado na máquina.
- `node --test scripts/security/test-session-query-cache.mjs`: **8/8**.
- `pnpm --filter api exec jest --runInBand`: **21 suítes, 144/144 testes**.
- `tsc --noEmit` nos dois apps: aprovado.
- Builds API e web (`NITRO_PRESET=node-server`) com Node 22: aprovados.
- ESLint completo da API e formatação dos arquivos alterados: aprovados.
- ESLint completo web com `--rule 'prettier/prettier: [error, {endOfLine: auto}]'`: sem erros, dez warnings de Fast Refresh; comando padrão bloqueado pelo CRLF original.
- Security lint: sem erros; existem warnings. Teste da configuração de lint: aprovado.
- Scripts HTTP: server functions, portal, sessão/credenciais, rate limits, headers, streaming do proxy e egress aprovados.
- Scripts de sessão browser, compatibilidade SMTP e TLS aprovados com dados sintéticos e endpoints locais.
- Revisão independente: três achados tratados por testes RED→GREEN; nenhuma alteração de produção.
- `git diff --check`: aprovado. Não houve mudança de dependências, migrations ou segredos.

O workflow inteiro (incluindo SQL/Deno e provedores reais) não foi executado nesta sessão. Não foram verificadas conexões de produção, publicação de containers ou implantação no Dokploy.
