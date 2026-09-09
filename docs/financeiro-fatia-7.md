# Financeiro: tela da empresa operadora e vínculo Inter

## Como acessar

1. Acesse **Financeiro > Empresa operadora**, no cabeçalho da página.
2. Confira a empresa e o CNPJ. Se houver mais de uma empresa acessível, selecione-a.
3. Escolha **Homologação** ou **Produção / Oficial**. A tela sempre inicia em homologação.
4. Confira final da conta, versão, validade do certificado e situação do vínculo.
5. Marque a declaração de confirmação e clique em **Confirmar vínculo**.

Trocar empresa/ambiente ou atualizar a consulta limpa a confirmação. Configuração
desatualizada exige nova revisão. Vínculo confirmado apresenta protocolo/data,
sem permitir repetição desnecessária. Em caso de falha, a tela apresenta o erro
e permite atualizar antes de tentar novamente; o backend mantém idempotência.

Admin/Financeiro precisam também do acesso financeiro de escrita à empresa.
Usuário com apenas leitura pode consultar. Ausência de empresas acessíveis
apresenta orientação para solicitar provisionamento/acesso. Nenhum acesso é
concedido automaticamente por esta interface.

**Confirmar não emite boleto, não comprova titularidade bancária, não altera o
ambiente padrão e não habilita envio ao banco.** A configuração de credenciais
continua em Configurações > Banco Inter; cadastro da tenant em Configurações > Empresa.

## Implementação e validação

- `inter-binding.functions.ts`: sessão validada, cliente com JWT do próprio usuário,
  RLS e RPCs da fatia 6. Sem service role ou leitura do Vault.
- `inter-binding-dialog.tsx`: interface responsiva com carga, vazio, erro/retry,
  somente leitura, confirmação explícita, envio e resultado.
- Listagem limitada a 100 empresas; excedente gera erro explícito, sem truncar silenciosamente.
- Teste `scripts/test-inter-binding-ui.mjs`: frontend real com APIs simuladas em
  1440/768/390 px, troca de ambiente, atualização, confirmação, leitura, vazio,
  erro/retry, console e dimensões. Evidências em `artifacts/inter-settings/binding-*.png`.
- 39 testes SQL da fatia 6 passaram com rollback de fixtures.
- Lint e build passaram. Typecheck permanece com 18 erros preexistentes em
  `demo.Tickets.$id.tsx`, nenhum nos arquivos desta entrega.

Skills: Lovable orientou a reutilização do visual, estados e validação responsiva;
Supabase orientou a manutenção das permissões e dos testes de isolamento.

Sem migrations ou Edge Functions novas. Publicação via GitHub > Dokploy.
Nenhum vínculo real confirmado durante os testes.

Próxima etapa: dados do pagador e fluxo homologado de emissão/retorno.

Atualização: o backend de pré-validação e snapshot do pagador está descrito na
[fatia 8](financeiro-fatia-8.md). A apresentação na tela e a emissão continuam
pendentes.

## Correção da consulta de perfil

A consulta `roles(name)` retornava HTTP 300 / `PGRST201` na API real: existem
duas FKs entre `user_roles` e `roles`. Corrigida para
`roles!user_roles_role_tenant_fkey(name)`, preservando o relacionamento composto
com tenant. Consulta real de leitura reproduziu o erro anterior e retornou
HTTP 200 com o perfil Admin após a correção. Os RPCs de revisão e escopo
foram verificados separadamente com papel authenticated: revisão aguardando
confirmação e acesso de escrita válido. Nenhuma permissão ou migration alterada.
