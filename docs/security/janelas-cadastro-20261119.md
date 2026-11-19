# Janelas de cadastro — validação de 19/11/2026

## Comportamento entregue

O componente compartilhado `Dialog` passa a oferecer cabeçalho Teal destacado, arraste pelo cabeçalho, movimento por teclado, maximizar/restaurar e minimizar com restauração por título. O corpo rola independentemente do cabeçalho. A geometria é limitada à viewport e recalculada ao restaurar depois de um redimensionamento.

Enquanto a janela está aberta, Radix mantém foco, clique e rolagem restritos ao modal. Ao minimizar, `Activity` suspende esses efeitos e preserva o estado React e os nós dos campos. A barra de janelas minimizadas fica na página quando não há modal ativo, ou dentro do modal ativo quando há janelas aninhadas. Fechar continua acionando o callback original; minimizar não chama `onOpenChange(false)`.

O editor de texto usa um proprietário de recursos fora de `Activity`. Assim, texto formatado, seleção e histórico de desfazer não dependem da remontagem dos efeitos do Tiptap. A instância é liberada no fechamento real ou na remoção do proprietário. O mecanismo também funciona fora de janelas, com criação somente no cliente e limpeza protegida contra replay de efeitos do React StrictMode.

O rascunho é mantido enquanto sua página/componente estiver aberto; não foi adicionada persistência em storage do navegador nem salvamento automático no banco.

## Abrangência e decisões de fluxo

- Cadastros que usam `ui/dialog.tsx` herdam o padrão, incluindo contratos, contatos, clientes, fornecedores, equipamentos, colaboradores, financeiro e configurações.
- Sete modais artesanais de tickets foram migrados para o contrato compartilhado. Pausa e históricos usam as janelas gerenciadas.
- As decisões obrigatórias de atendimento (Salvar/Ignorar tempo, resolução, situação pendente e início de atendimento) preservam o bloqueio. Minimizar o apontamento permitiria iniciar outro cronômetro e alterar o horário do lançamento pendente; esse fluxo não recebe controles de janela.
- `AlertDialog` preserva as confirmações destrutivas. Busca de comandos e navegação móvel também mantêm suas semânticas.
- Os novos tokens de cabeçalho atendem contraste AA; ícones têm nomes acessíveis, controles móveis têm 44 px e redução de movimento é respeitada.

## Evidências

| Verificação | Resultado |
|---|---|
| Web TypeScript | Sem erros |
| Build Node/SSR com credenciais sintéticas | Aprovado |
| Web ESLint completo | Sem erros; 10 avisos preexistentes |
| Navegador com componentes reais e StrictMode | 17 verificações aprovadas, sem erros de execução |
| Regressão UI de contatos/importação/portal | 14 verificações aprovadas |
| Contratos de clientes e fornecedores | Criação/edição/remoção de rateio aprovadas em 1440, 768 e 390 px |
| Revisão independente | Achados de restauração, cronômetro e editor corrigidos e verificados |

O teste `scripts/security/test-dialog-windows.mjs` cobre geometrias normal/maximizada, arraste, teclado, redimensionamento enquanto minimizado/maximizado, foco/scroll/clique no fundo, arquivos selecionados, estado React, janelas aninhadas, Select/Popover, confirmação, múltiplos rascunhos, fechamento, remoção do proprietário e temas claro/escuro em desktop/tablet/mobile.

O teste também confirma HTML formatado, edição e desfazer antes/depois de minimizar, editor novo ao reabrir e saldo de recursos ativos igual a zero após fechar ou remover o proprietário. Janelas filhas preservam sua instância quando a filha e depois o pai são minimizados e restaurados; o pai também é responsável pela limpeza final dos recursos da filha. As ferramentas de navegador são instaladas isoladamente no job `dialog-windows`; não entram nas dependências ou imagens da aplicação.

Capturas e logs locais ficam em `node_modules/.cache/dialog-windows-qa/`, ignorado pelo Git. Nenhum teste usa credenciais ou dados de clientes.

## Publicação

Esta atualização modifica a interface e não exige migration. A publicação autorizada deve usar o commit aprovado pelo CI, preservar a imagem anterior do frontend e verificar HTTPS e saúde da API após o rollout.
