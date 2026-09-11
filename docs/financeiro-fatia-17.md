# Financeiro: fornecedores recorrentes

## Escopo

Esta fatia inicia Contas a Pagar com o cadastro de fornecedores e contratos de
fornecimento por empresa operadora. Nenhum lançamento a pagar é gerado
automaticamente nesta etapa.

## Fornecedores

O cadastro guarda razão social, nome fantasia, CPF ou CNPJ, categoria, contato,
e-mail, telefone, observações e situação. As categorias iniciais são
licenciamento de software, datacenter/cloud, conectividade, serviços
profissionais e outros.

## Contratos de fornecimento

Cada fornecedor pode ter vários contratos. O contrato define:

- unidade de cobrança fixa, por usuário ativo ou por dispositivo;
- periodicidade mensal, trimestral, semestral ou anual;
- valor fixo do período ou preço unitário com quatro casas decimais;
- vencimento, vigência, situação e observações.

As unidades `active_users` e `devices` foram alinhadas aos snapshots de consumo
já usados pelo Contas a Receber. A próxima fatia poderá ratear custos sem criar
uma segunda fonte de apuração.

## Interface

Em **Financeiro > Contas a pagar**, o usuário escolhe a empresa operadora,
consulta indicadores, pesquisa e filtra fornecedores, edita seus dados e
gerencia contratos de fornecimento. A tela trata carregamento, vazio, erro,
somente leitura e formulários responsivos.

## Segurança e histórico

- RLS por tenant, empresa operadora e concessão financeira;
- inclusão e alteração exigem acesso financeiro de escrita;
- usuários com acesso de leitura não alteram registros;
- exclusão física não é concedida e o arquivamento usa `deleted_at`;
- fornecedor com contrato ativo não pode ser arquivado;
- tenant, empresa, fornecedor e autoria não podem ser trocados;
- toda inclusão, alteração e arquivamento entra na auditoria financeira.

## Componentes

- Migration: `20260911164507_payable_suppliers_foundation.sql`.
- Tabelas: `suppliers` e `supplier_contracts`.
- Interface: `PayableSuppliers`, integrada à rota `/finance`.
- Testes: 24 cenários transacionais de RLS, precisão, validação, auditoria e
  soft delete.
