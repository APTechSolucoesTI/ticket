# Contatos: pelo menos um e-mail ou telefone

Data: 18/11/2026. Base: `c2a07d0`, branch local `codex/priority-session-whatsapp`.

## 1. Stack Tecnológica & Ecossistema

Mantidos React, TanStack, Zod, Supabase/PostgreSQL e NestJS existentes. Nenhuma dependência adicionada. O módulo `apps/web/src/lib/contact-channels.ts` concentra a validação dos campos principais e da presença de canais; formulários, importação e portal usam a mesma regra. `portal-chat-state.ts` trata a identidade persistida do chat com e-mail nullable.

## 2. Infraestrutura & Deploy

Aplicar `supabase/migrations/20261118120000_contacts_require_channel.sql` antes de publicar a nova versão web/API. O banco já aceita NULL em `email`; a migration substitui a constraint que exigia e-mail de contatos vinculados por `contacts_channel_required`.

A nova constraint exige pelo menos um canal em INSERTs e qualquer UPDATE, inclusive de contatos sem cliente. Canais secundários também contam; continuam passando pela normalização, validação e unicidade existentes. Não há nova variável de ambiente ou alteração de ACL/RLS.

Contatos antigos sem nenhum canal não recebem identificadores fictícios. A constraint é criada `NOT VALID` e validada automaticamente somente quando o inventário estiver limpo. Se houver legados, ficam preservados, mas precisam de um canal real antes de sua próxima atualização. O SQL da migration inclui consulta de inventário somente leitura e comando de validação após saneamento.

O rollback restaura a regra antiga sem excluir contatos novos com apenas telefone. Caso existam contatos vinculados sem e-mail principal, a constraint antiga permanece `NOT VALID`; gravações posteriores sob a regra antiga voltarão a exigir e-mail. Conferir essa incompatibilidade antes de reverter a aplicação.

Nenhuma migration, publicação, push ou acesso à produção ocorreu nesta entrega. A suíte Supabase completa permanece para o CI; o teste PostgreSQL local usa cluster temporário em loopback e dados sintéticos.

## 3. Arquitetura & Conceitos de Domínio

| E-mail | Telefone | Resultado |
|---|---|---|
| Válido | Vazio | Salva |
| Vazio | Válido | Salva |
| Válido | Válido | Salva |
| Vazio | Vazio | Exige pelo menos um canal |
| Inválido | Válido | Exige corrigir o e-mail informado |
| Válido | Inválido | Exige corrigir o telefone informado |

Campos em branco são normalizados e persistidos como NULL; e-mails mantêm trim/minúsculas e telefones mantêm a normalização existente. Um campo preenchido inválido não é ignorado apenas porque o outro é válido. Não é permitido apagar o último canal.

No portal, o PATCH preserva os canais secundários existentes e os considera para validar a permanência de um canal. Consultas e gravações continuam limitadas ao tenant e cliente do administrador. O cadastro com apenas telefone não faz consulta de duplicidade de e-mail vazio nem tenta enviar convite para um endereço ausente; a resposta indica convite não aplicável. O login/OTP continua por e-mail, sem novo método de autenticação por telefone.

O chat aceita sessões cujo e-mail principal se tornou NULL. Chats novos são associados ao ID estável do contato; caches legados só são associados por e-mail quando ambos os e-mails são não vazios. Caches malformados são descartados. A busca de mensagens utiliza a sessão/token, sem depender da presença de e-mail.

Na resposta de tickets por e-mail, o destinatário principal continua preferido. Na ausência dele, utiliza-se o primeiro e-mail secundário cadastrado. Se não houver nenhum e-mail, a operação de envio por e-mail continua recusada, mesmo que o contato tenha telefone.

## 4. Inventário de Funcionalidades (Features)

| Fluxo | Alteração |
|---|---|
| Cadastro/edição internos | E-mails e telefones sem obrigatoriedade individual; ajuda comum e erros por campo |
| Importação XLSX | Mapeia e-mail ou telefone; cada linha precisa de um canal válido e mantém motivo de rejeição |
| Gestão pelo portal | Cadastro só com telefone, campos nullable, ausência de convite e preservação de secundários na edição |
| Chat do portal | Identidade por contato e tratamento de sessão sem e-mail principal |
| Resposta por e-mail | Fallback para secundário quando não há principal |
| Banco | Regra mínima de canal, proteção de identificadores, rollout sem dados fictícios |

## 5. Code Quality & Technical Debt (Bônus Técnico)

O plano `docs/superpowers/plans/2026-11-18-contact-required-channel.md` registra os resultados finais e a revisão. As regressões foram escritas antes das respectivas correções: telefone sem e-mail era rejeitado pela API e pela constraint anterior; os consumidores do chat e do envio por e-mail também foram avaliados para a nova representação nullable.

Validações locais: testes PostgreSQL de canais/legados/RLS/rollback, testes de fronteira e HTTP do portal, regressões existentes do portal e 181 testes API em 27 suítes aprovados. Playwright aprovou 14 grupos, incluindo cadastro/edição/importação, matriz visual desktop/tablet/mobile claro/escuro, teclado/foco e ausência de overflow/erros JavaScript. O portal com e-mail NULL criou chat, leu mensagens, enviou resposta e restaurou a conversa após reload em desktop/mobile. As revisões independentes foram concluídas sem achados críticos ou importantes remanescentes.

Typechecks e builds web/API aprovados. Lint API e dos arquivos web alterados aprovados; no checkout Windows, o lint web usou a exceção local `endOfLine: auto`, sem alteração de configuração. Lint de segurança sem erros, com 140 warnings existentes. A árvore de rotas gerada não teve alteração de conteúdo.

Comandos de reprodução, após build web de fixture com preset node-server:

```powershell
node scripts/security/test-contact-channels.mjs
node scripts/security/test-contact-channels-http.mjs
node scripts/security/test-portal-chat-contact.mjs
node scripts/security/test-portal.mjs
# PostgreSQL e Playwright opcionais no cache ignorado, conforme demais ensaios do projeto:
node scripts/security/test-contact-channels-postgres.mjs
node scripts/security/test-contact-channels-ui.mjs
pnpm --filter web exec tsc --noEmit
pnpm --filter api exec jest --runInBand
```

Os testes recebem somente destinos e credenciais sintéticos. Capturas UI ficam no diretório ignorado `node_modules/.cache/contact-channel-ui-qa`; não são evidência de publicação nem de validação contra o banco real do ambiente.
