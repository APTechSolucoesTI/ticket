# Janelas uniformes de cadastro

## Objetivo e comportamento

Padronizar os cadastros e edições do APTicket conforme as referências fornecidas: barra de título destacada, arraste pelo cabeçalho, maximizar/restaurar e minimizar/restaurar. A tela de fundo permanece bloqueada enquanto a janela está aberta; o arraste serve para visualizar o conteúdo coberto. Minimizar libera a tela de fundo e mantém os dados do formulário. Esta regra foi confirmada pelo usuário em 19/11/2026.

O cadastro minimizado aparece em uma barra inferior com seu título e ações de restaurar e fechar. Fechar usa a mesma regra de fechamento existente no formulário. Não há salvamento automático nem persistência nova de dados sensíveis no navegador. A manutenção do rascunho vale enquanto a página/componente que o contém continuar aberto.

## Abordagens

- Alterar cada formulário individualmente repetiria comportamento e criaria divergências entre os módulos.
- Substituir a biblioteca de modais ampliaria o risco de regressões em selects, popovers, foco e confirmações.
- **Decisão técnica recomendada:** evoluir a API compartilhada de `ui/dialog.tsx`, mantendo Radix e os estados dos formulários existentes. Migrar os modais artesanais de tickets para esse contrato. É a opção que atende à uniformidade sem duplicar regras de negócio.

## Estrutura

- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` e demais exports continuam compatíveis.
- Uma barra de título própria fica fora da área de rolagem. O título é registrado pelo componente existente, incluindo títulos dentro de wrappers de configuração.
- O corpo mantém as classes e o layout de cada formulário; os controles da janela não submetem o formulário.
- Estado da janela: normal, maximizada ou minimizada. Restaurar recupera tamanho/posição anteriores. Ao fechar e reabrir, a geometria retorna ao padrão.
- Arraste por pointer events, restrito ao cabeçalho, com limites que mantêm a janela acessível. Botões não iniciam arraste. Teclado oferece movimentação por setas com foco no cabeçalho e instrução acessível. Redimensionamento da viewport mantém os controles alcançáveis.
- React `Activity` será validado em navegador como mecanismo para preservar estado/DOM e suspender efeitos de foco, bloqueio de scroll e `aria-hidden` durante a minimização. A implementação só será aceita se os testes confirmarem a liberação efetiva do fundo e a restauração sem perda de valores, arquivos e estado interno. Referência: https://react.dev/reference/react/Activity.
- Recursos imperativos, como o editor de texto, têm um proprietário fora dessa suspensão. A instância e o histórico de desfazer sobrevivem à minimização; fechar a janela ou remover seu proprietário libera esses recursos. A criação acontece apenas no cliente, com proteção para replay de efeitos em StrictMode.
- A barra de janelas minimizadas é compartilhada e identifica cada cadastro. Seus registros são removidos ao fechar ou desmontar o proprietário.
- Confirmações destrutivas, escolhas obrigatórias, busca de comandos e navegação móvel mantêm suas semânticas. Não recebem minimização que permita contornar uma decisão obrigatória. O apontamento ao encerrar o cronômetro é uma decisão obrigatória de Salvar/Ignorar: mantém o bloqueio para evitar que iniciar outro cronômetro altere o horário do apontamento pendente.

## Visual e acessibilidade

Barra sólida com tokens semânticos `window-header`/`window-header-foreground`: no claro, Teal institucional `brand-medium` com branco (contraste calculado de 5,98:1); no escuro, Cyan com texto escuro. Título legível, controles Lucide com nomes acessíveis, foco visível e tooltip. Temas claro/escuro, redução de movimento e áreas de toque de 44 px no mobile. Em telas pequenas, o cadastro ocupa a área útil; arraste fica desabilitado quando não houver espaço seguro para deslocamento. Não há gradiente operacional.

## Cobertura e aceitação

O inventário encontrou 70 instâncias efetivas do componente compartilhado em 46 arquivos, além de sete modais artesanais na tela de tickets. Os formulários de contratos, contatos, clientes, equipamentos, fornecedores, colaboradores, financeiro e configurações devem herdar o mesmo padrão.

Testes de navegador devem demonstrar: título e controles; maximizar/restaurar; arraste e limites; minimizar com liberação de clique/foco/scroll no fundo; restauração de estado React, texto não controlado e arquivo selecionado; múltiplas janelas minimizadas; diálogos aninhados, Select/Popover e confirmação; fechamento existente; desktop/tablet/mobile; temas e ausência de erros de execução. Typecheck, lint, build e CI devem passar antes do deploy.

## Publicação

O usuário já autorizou publicar esta atualização após a conclusão. Preparar uma branch separada, revisão e CI; publicar somente após as verificações. Esta entrega é de interface e não prevê migration. Preservar a imagem anterior e validar HTTPS, saúde da API e frontend após o rollout.
