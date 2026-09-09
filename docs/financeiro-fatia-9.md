# Financeiro: revisão e confirmação do pagador Inter

## Como usar

1. Em **Financeiro**, localize uma conta a receber recorrente e abra
   **Cobrança Inter**.
2. Se ainda não houver solicitação no ambiente desejado, confira o recebível e
   registre a preparação.
3. Na seção **Dados do pagador**, confira nome, CNPJ, telefone, endereço, valor,
   vencimento e `seuNumero`.
4. Se o cadastro estiver incompleto, use **Abrir cadastro de clientes**, corrija
   os campos indicados e atualize a revisão.
5. Se o vínculo estiver ausente, confirme-o em **Financeiro > Empresa operadora**
   no mesmo ambiente e atualize a revisão.
6. Com perfil Admin ou Financeiro e acesso financeiro de escrita, marque a
   declaração e clique em **Confirmar pagador**.

A confirmação registra um snapshot imutável. Se o cadastro do cliente, o valor,
o vencimento ou o vínculo forem alterados, a tela apresenta **Confirmação
desatualizada** e exige uma nova conferência. Usuários sem acesso de escrita
visualizam os dados em modo somente leitura.

**Preparar e confirmar ainda não emitem boleto, não enviam dados ao Banco Inter
e não alteram o status financeiro.** O despacho permanece bloqueado até a etapa
de homologação do processador bancário.

## Implementação

- `inter-charges.functions.ts` valida as respostas dos RPCs, mantém a sessão do
  usuário e calcula a autorização com escopo financeiro e perfil
  Admin/Financeiro. Nenhuma service role é usada no navegador ou no servidor web.
- `inter-payer-review.tsx` apresenta carga, erro/retry, cadastro incompleto,
  vínculo necessário, confirmação pendente/desatualizada, confirmado e somente
  leitura.
- A confirmação enviada ao backend contém o fingerprint, vínculo e snapshot
  exibidos. O backend rejeita concorrência ou dados alterados e a interface exige
  uma nova consulta.
- O modal recebeu altura máxima baseada na viewport e rolagem interna, evitando
  estouro em telas menores.

## Verificação e publicação

- Lint passou nos arquivos alterados e o build de produção Node foi concluído.
- O typecheck mantém somente os 18 erros preexistentes em
  `demo.Tickets.$id.tsx`; não há erro nos arquivos desta entrega.
- `scripts/test-inter-charge-ui.mjs` usa o frontend real com APIs simuladas e
  valida preparação, confirmação, cadastro incompleto, vínculo ausente,
  recebível alterado, somente leitura, retry, console e dimensões em 1440, 768 e
  390 px. Nenhum recebível, snapshot ou boleto real é criado.
- A inspeção visual confirmou ausência de estouro horizontal em desktop, tablet
  e celular.

Skills: Lovable orientou a composição responsiva e os estados visuais; Supabase
orientou o uso dos RPCs protegidos, do RLS e da autorização já implantada.

Não há migration nem Edge Function nova nesta fatia. A publicação web ocorre via
GitHub > Dokploy.

O processador manual de emissão em homologação foi concluído na
[fatia 10](financeiro-fatia-10.md). O acompanhamento assíncrono por webhook ou
consulta ativa permanece como próxima etapa.
