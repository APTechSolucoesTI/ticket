# Configuração do Banco Inter por tenant

## Como usar

1. Acesse **Configurações > Banco Inter** dentro do tenant.
2. Escolha **Homologação** ou **Produção / Oficial**.
3. Informe conta corrente com dígito (sem pontuação/zeros à esquerda), Client ID e Client Secret.
4. Envie certificado PEM (`.crt`/`.pem`) e chave privada PEM (`.key`/`.pem`), sem senha, até 32 KB cada. PFX não é aceito nesta tela.
5. Salve. Na primeira configuração são exigidos os quatro dados de autenticação.
6. Para usar esse ambiente como padrão, marque a opção correspondente. Produção exige confirmação adicional. O outro ambiente permanece salvo, mas deixa de ser o selecionado.

Nas próximas edições, campos secretos vazios preservam os valores atuais. Ao trocar o Client ID, envie também o Client Secret. Certificado e chave são substituídos juntos. A tela informa validade e impressão digital do certificado, sem disponibilizar download dos segredos.

Utilize HTTPS ao acessar o sistema e enviar credenciais bancárias. Não coloque certificados/chaves no Git nem em anexos públicos.

## Permissões e armazenamento

Consulta: `configuracoes:view` e `empresa:view`. Alteração: `configuracoes:view` e `empresa:edit`, com sessão válida e perfil ativo. O tenant vem da sessão validada no servidor, não de um campo editável no formulário.

Credenciais são cifradas no Supabase Vault, separadas por tenant e ambiente. `tenant_inter_configurations` contém os metadados e a referência privada do Vault; `inter_configuration_audit` registra ator, data e operação, nunca os segredos. O navegador não tem acesso direto a essas tabelas nem ao RPC de serviço.

O backend valida o par certificado/chave e sua vigência. Isso **não** comprova que as credenciais pertencem ao ambiente selecionado ou foram autorizadas pelo banco: essa confirmação depende da futura autenticação com o Inter.

Controle de versão impede que uma edição desatualizada sobrescreva outra; um lock por tenant garante apenas um ambiente selecionado. Nenhuma configuração real é criada automaticamente.

## Limite desta entrega

Esta tela configura o Inter **no nível do tenant**, com uma conta por ambiente. Não provisiona as empresas operadoras/acessos financeiros das fatias anteriores nem habilita contratos para recorrência. Múltiplas contas/empresas dentro do tenant continuam sendo uma evolução futura.

Salvar/selecionar produção não emite boletos, não registra webhook e não movimenta a conta. Autenticação bancária, emissão, teste de conexão e conciliação ainda serão implementados. Não há botão que simule uma conexão bem-sucedida.

## Validação

- 19 testes pgTAP: permissões, tenants, ambientes independentes, concorrência por versão, Vault e auditoria, todos com rollback.
- Cinco verificações de certificado: par válido, formato inválido, chave incompatível, vencido e ainda não vigente.
- Playwright na página real com respostas simuladas, sem acessar banco/tenant reais: 1440, 768 e 390 px; validação de campos, confirmação de produção, salvamento simulado, ocultação de segredos, somente leitura, erro e nova tentativa. Evidências locais em `artifacts/inter-settings` (fora do Git).
- Lint dos arquivos novos e build passaram. Typecheck global permanece com os 18 erros preexistentes em `demo.Tickets.$id.tsx`, sem erros nos arquivos desta entrega.
- Advisor de segurança não apontou os novos objetos.

Scripts: `scripts/test-inter-ui.mjs` (Playwright 1.63.0 via `PLAYWRIGHT_MODULE`, aplicação local na porta 4173) e `scripts/test-inter-certificate.mjs` (`node --experimental-strip-types`, OpenSSL via `OPENSSL_BIN`).

Migration: `20260908202134_tenant_inter_configuration.sql`. Publicar a migration antes do frontend pelo fluxo GitHub → Dokploy.
