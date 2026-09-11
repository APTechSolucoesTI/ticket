# Financeiro: envio da régua de cobrança

## Escopo

O backend processa a cada 15 minutos as réguas ativas, reserva as ações de
forma concorrente e realiza o envio pelos canais configurados na tenant.

- E-mail utiliza a conta SMTP de **Configurações > E-mail**.
- WhatsApp utiliza a instância UAZAPI de **Configurações > WhatsApp**.
- SMS permanece bloqueado e registra falha não retentável enquanto não houver
  um provedor configurado.

O destinatário é o primeiro contato ativo da empresa que possui o dado exigido
pelo canal. Os dados do contato e o conteúdo são congelados no momento em que a
ação é criada.

## Segurança operacional

- somente a credencial de serviço pode reservar ou concluir ações;
- `FOR UPDATE SKIP LOCKED` impede dois workers de enviarem a mesma ação;
- ações interrompidas voltam à fila depois de 30 minutos;
- erros temporários têm até cinco tentativas com espera progressiva;
- conteúdo, destinatário e vínculo financeiro são imutáveis;
- identificador externo, tentativas e falhas ficam registrados na auditoria.

Ativar uma régua passa a autorizar o envio real de e-mails e mensagens de
WhatsApp conforme as etapas salvas. Os testes automatizados utilizam serviços
simulados e nunca chamam provedores externos.
