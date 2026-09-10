# Financeiro: emissão controlada no ambiente oficial do Inter

## Escopo

A emissão de boleto com Pix passa a aceitar **Produção / Oficial**, além de
Homologação. A preparação e a confirmação do pagador continuam sem enviar dados
ao banco. O POST bancário só ocorre após uma segunda autorização explícita na
tela de cobrança.

## Barreiras obrigatórias de produção

Antes de criar a tentativa oficial, o banco valida novamente:

- sessão ativa com perfil Admin ou Financeiro;
- acesso financeiro de escrita à empresa operadora;
- recebível, valor, vencimento e snapshot do pagador ainda vigentes;
- vínculo da empresa com a configuração oficial atual;
- configuração de produção selecionada como ativa e certificado válido;
- webhook oficial registrado e com segredo protegido;
- confirmação específica de que a cobrança enviada será real.

A confirmação oficial fica registrada na tentativa. Concorrência, limite de
tentativas, intervalo mínimo, estado incerto e idempotência seguem as mesmas
regras já usadas em homologação. Nenhum teste automatizado executa POST real no
Inter.

## Interface

Na conta a receber, abra **Cobrança Inter**, selecione **Produção / Oficial**,
registre a preparação, confirme o pagador e revise o aviso destacado. O botão
**Emitir cobrança oficial** só é habilitado depois da marcação consciente da
autorização.

Depois do envio, **Consultar no Inter** e o webhook confirmado atualizam o
estado bancário e o contas a receber usando o mesmo reconciliador das cobranças
de homologação.

## Componentes

- Migration: `20260910185005_enable_inter_production_dispatch.sql`.
- Edge Function: `emitir-cobranca-inter` com seleção de host por ambiente.
- Interface: revisão do pagador e confirmação reforçada para produção.
- Testes: fluxo de banco transacional e chamadas HTTP simuladas para os dois
  ambientes.

Referência oficial: [API Cobrança V3 do Inter](https://developers.inter.co/references/cobranca-bolepix).
