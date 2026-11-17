# Cadastro de empresa e chat transacionais

Data: 17/11/2026. Continuação da entrega `9d30b38`, na branch `codex/priority-session-whatsapp`.

## Comportamento

- O cadastro usa `apticket.provision_tenant`: tenant, defaults dos triggers, perfil com hash bcrypt e vínculo Admin são confirmados juntos. Falha em qualquer etapa desfaz as demais. O banco gera IDs e slug, normaliza o e-mail e mantém a restrição de unicidade.
- A abertura de chat usa `apticket.create_portal_chat`: revalida o contato, tenant, cliente e contrato; grava ticket e mensagem inicial na mesma transação. Falha de mensagem não retorna sucesso nem deixa ticket parcial.
- As RPCs usam `SECURITY INVOKER`, com execução concedida somente a `service_role`. O handler do portal fornece os IDs da sessão HMAC validada, e não os IDs enviados no JSON.
- Contatos e contratos autorizadores ficam protegidos por locks durante a transação.
- O trigger de classificação foi ajustado para chat sem equipamento: preserva contrato explicitamente válido e exclui contratos removidos, fora da vigência ou sem cobertura. Os demais caminhos continuam usando o resolver existente.
- Erros internos do banco ficam no servidor; o cadastro preserva mensagem específica para e-mail duplicado.

## Evidências

- Antes da correção, o teste HTTP observou tenant persistido após falha no perfil e HTTP 201 após falha na mensagem do chat.
- A revisão independente detectou que o trigger legado substituía o contrato validado. A inclusão do trigger real no teste reproduziu a falha antes da correção.
- PostgreSQL **17.6** descartável: rollback/reaplicação da migration, privilégios, falhas em perfil/papel/mensagem, e-mail normalizado duplicado, tenant estrangeiro, contatos bloqueados e contratos inválidos/removidos/futuros.
- Duas conexões reais disputando o mesmo e-mail: uma conta completa e uma rejeição por unicidade; nenhum tenant órfão.
- Duas conexões reais: desativação concorrente de contato e contrato bloqueada até o fim da transação de chat.
- HTTP compilado: cadastro, chat, proteção contra erros internos, limite de autenticação, portal, sessão, headers e server functions aprovados.
- Node **22.23.5**: 144 testes da API e oito regressões de isolamento de sessão aprovados; typechecks e build web aprovados.
- Lint dos arquivos TypeScript alterados aprovado. Security lint sem erros, com warnings existentes; o problema de CRLF do lint web global continua registrado na primeira entrega.

O teste PostgreSQL local extrai o DDL relevante e os triggers de papéis/classificação do snapshot versionado. Não substitui o ensaio completo do Supabase: o arquivo `supabase/tests/atomic_onboarding_portal_chat_test.sql` também entra automaticamente no job SQL completo do CI. Esse job completo não foi executado localmente.

## Publicação

1. Aplicar `supabase/migrations/20261117120000_atomic_onboarding_portal_chat.sql` com o procedimento de migrations do ambiente.
2. Confirmar presença e grants das duas RPCs e recarga do schema PostgREST.
3. Publicar a nova versão web e validar cadastro/chat com dados de homologação.

O código novo depende das RPCs. Publicá-lo antes da migration fará os fluxos recusarem a operação. Não foi adicionado fallback para o fluxo de gravações separadas.

Para reverter, restaurar primeiro a versão web anterior e depois aplicar `supabase/rollbacks/20261117120000_atomic_onboarding_portal_chat.sql`. O rollback remove as RPCs e restaura a classificação anterior; não apaga dados de clientes.

Nenhuma migration, conexão ou publicação em produção foi executada nesta sessão.

## Reproduzir o ensaio local no Windows

Ferramentas opcionais, fora das dependências do produto:

```powershell
npm.cmd install --prefix node_modules/.cache/atomic-flow-tools --no-package-lock --ignore-scripts @embedded-postgres/windows-x64@17.6.0-beta.15 pg@8.23.1
node scripts/security/test-atomic-workflows-postgres.mjs
```

O runner cria um cluster temporário com dados sintéticos, usa somente `127.0.0.1` em porta aleatória e remove seu próprio diretório após desligar o banco. Fonte dos binários de teste: [embedded-postgres](https://github.com/leinelissen/embedded-postgres).
