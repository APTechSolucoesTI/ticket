# Revisão de segurança — 15/09/2026

## Escopo

- Isolamento multi-tenant e políticas RLS do schema `apticket`.
- Funções `security definer`, permissões de execução e `search_path`.
- Autorização das novas operações financeiras e de contratos.
- Uso de conteúdo HTML, credenciais privilegiadas e metadados de autenticação.
- Dependências de produção do frontend e da API.

## Correções realizadas

- A função `apticket.enforce_service_remote_only` passou a usar `search_path` imutável.
- As novas funções privilegiadas validam usuário autenticado, tenant, empresa operadora,
  escopo financeiro e permissão de módulo antes de alterar dados.
- A exclusão direta de contratos de clientes foi revogada. A operação agora é lógica,
  auditável e recusada quando existe medição. Contratos de fornecedores seguem a mesma regra.
- Categorias e centros de custo são validados no banco quanto a tenant, empresa operadora,
  situação ativa e direção financeira compatível.
- Funções internas de trigger não podem ser executadas diretamente por perfis da API.
- Foram atualizadas dependências vulneráveis ligadas a planilhas, e-mail, uploads multipart,
  YAML, URLs e editor de texto. A auditoria ficou sem vulnerabilidades altas ou críticas.

## Verificações sem achados exploráveis

- As tabelas de negócio permanecem com RLS habilitado.
- Tabelas internas sem política de leitura continuam em modo de negação por padrão.
- As funções anônimas encontradas são somente os endpoints públicos intencionais protegidos
  por token (relatórios, satisfação e portal).
- Os usos de HTML dinâmico passam por sanitização antes da renderização.
- Não foi encontrado uso de metadados editáveis do usuário para conceder autorização.
- Não foi encontrada chave `service_role` exposta ao código executado no navegador.

## Validações executadas

- Build de produção do frontend e da API.
- Lint dos arquivos alterados.
- 42 testes automatizados da API.
- Auditoria de dependências de produção.
- Aplicação transacional da migration antes da publicação definitiva.

