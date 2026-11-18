# Contatos com e-mail ou telefone

**Base:** `c2a07d0`; branch local existente. Pedido: permitir salvar qualquer contato com pelo menos um e-mail ou telefone, sem exigir os dois.

**Desenho:** validação comum de canais, aplicada no formulário interno, importação e portal; vazios viram NULL na persistência. Canais informados continuam validados e os secundários/duplicidade continuam protegidos. Banco recebe constraint incremental para todos os novos/alterados, sem inventar identificadores para legados sem canal. Convite/OTP por e-mail continuam exigindo e-mail: cadastro só com telefone é permitido, sem tentativa de convite vazio.

**Alternativas:** mudar apenas o formulário deixaria banco/portal/importação recusando o telefone; remover toda validação permitiria contatos sem identificador. Escolhida regra equivalente nas fronteiras e no banco. Não criar login por telefone nem alterar permissões.

## Etapas

- [x] RED/GREEN de schema compartilhado: e-mail, telefone, ambos, nenhum, whitespace, inválidos e secundários.
- [x] Formulário interno e importação: labels, ajuda, erros, mapeamento alternativo e payloads NULL.
- [x] Portal API/UI: criação/edição com telefone, duplicidade condicional, convite somente com e-mail e respostas claras.
- [x] SQL (tarefa independente): migration/rollback/testes PostgreSQL e regressões de fixtures/identificadores/RLS; execução local final exit 0.
- [x] HTTP e UI real aprovados: 14 grupos, desktop/tablet/mobile claro/escuro, importação XLSX, teclado/foco, fontes fallback, sem overflow/pageerrors; portal desktop/mobile com e-mail NULL, mensagens/resposta e restauração por contato.
- [x] Revisão independente: TypeError e polling de chat dependentes de e-mail corrigidos com RED/GREEN; resposta por e-mail ganhou fallback secundário, nove testes novos. Revisão final sem Critical/Important remanescentes.
- [x] Typechecks API/web, lint API/arquivos web alterados, builds API/web e lint de segurança aprovados; documentação concluída e entrega preparada para commit local após diff. Sem publicação ou produção.

## Evidências

- Banco: RED 23514 `contacts_registered_email_required` para telefone-only; GREEN dos testes novo/antigo e validação condicional de legados, rollback/reaplicação. As fixtures sintéticas afetadas foram corrigidas com e-mails de teste.
- HTTP real do portal: RED 400 em cadastro telefone-only; GREEN 201 sem convite, NULL/normalização, validação, preservação de secundários e rejeição da remoção do último canal. Regressões existentes do portal aprovadas.
- Revisão reproduziu TypeError em e-mail NULL; helper de identidade/cache passou. Playwright reproduziu RED com chat parado em “Aguardando mensagens”; após remover a guarda de e-mail, start/poll/reply/reload passaram.
- API: nove testes novos de resposta por e-mail; suíte completa 181 testes/27 suítes aprovada. SMTP é falso nos testes; não há envio real.
- Typechecks API/web e lint dos arquivos web/API aprovados. Build web final aprovado com preset node-server e valores de fixture; build API aprovado. Lint de segurança: zero erros e 140 warnings existentes. Lint web nos arquivos alterados usou a exceção local `endOfLine: auto` do checkout Windows; nenhuma configuração foi modificada.

Capturas/resultados UI em `node_modules/.cache/contact-channel-ui-qa`, ignorado pelo Git. Relatório: `docs/contatos-email-ou-telefone-20261118.md`. Não foi executada a suíte Docker/Supabase completa localmente.

## Casos de revisão

Contato com telefone não deve receber convite para endereço vazio. E-mail incorreto não deve ser ignorado porque há telefone. Não permitir apagar o último canal. Preservar canais secundários existentes no PATCH do portal e a unicidade entre contatos. Legados sem canal exigem correção, sem valores fictícios; o rollback do banco deve descrever a incompatibilidade com contatos novos sem e-mail.
