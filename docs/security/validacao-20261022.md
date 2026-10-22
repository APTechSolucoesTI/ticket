# Validação de segurança — 22/10/2026

Continuação da [validação de 21/10](./validacao-20261021.md). Os estados abaixo
distinguem controles publicados, código validado e manutenção futura.

## Produção e CI

- SEC-06: limites aprovados publicados no frontend
  `dd89363028aa93fc76cd25a2d1144d5674634681`. Deployment `done` criado em
  `2026-10-22T16:59:35.973Z`, Swarm concluído, checkout conferido e `/auth` HTTP 200.
  Login: 10 tentativas/identidade/15 minutos e 100/origem/15 minutos;
  recuperação e conclusão de reset/convite: 5/identidade ou hash de token/15 minutos,
  com proteção adicional por origem; cadastro: 5/origem/hora. OTP: 5/e-mail/15 minutos,
  preservando o limite existente por origem. Respostas genéricas, HTTP 429 e
  Retry-After, sem bloqueio permanente. O contador compartilhado já estava instalado.
  Testes usam dois processos web, concorrência real, normalização de identidade,
  tentativa de forjar prefixos de encaminhamento e indisponibilidade do contador.
- SEC-10: o [CI `3643a18`](https://github.com/APTechSolucoesTI/ticket/actions/runs/39819970926)
  aprovou os cinco jobs. São **40 arquivos e 1.544 asserções SQL**, mais quatro
  verificações de backfill. As **112 tabelas com tenant** recebem probes de
  SELECT/UPDATE/DELETE por um administrador de outro tenant; nenhuma ficou sem
  fixture. O runner agora falha se aparecer uma tabela sem cobertura.
  [Metadados de cobertura](./cobertura-sql-20261022.json), sem linhas de clientes.
  Existem 118 tabelas no schema; as seis restantes não têm coluna tenant_id.
  Não confundir esses probes com uma prova de todas as regras de negócio ou com
  CRUD positivo completo para cada papel: os controles positivos de leitura e
  os cinco domínios com CRUD completo têm seus limites registrados nos testes.
- O bloqueio histórico do lint foi resolvido nos lotes anteriores. O lint web
  atual tem zero erros e dez avisos; typechecks web/API passaram. O CI também
  cobre builds, HTTP, sessões, SMTP/TLS, SSRF, Edge, dependências e segredos.

## SEC-09 — código validado, ativação ainda pendente

O serviço privado de ClamAV está implantado, saudável, sem porta publicada,
com assinaturas persistentes, memória limitada a 4 GiB e imagem fixada por digest.
O teste real de protocolo aceitou bytes sintéticos limpos e recusou EICAR.
Não foram enviados arquivos de clientes nem malware real ao scanner.

O lote de aplicação preparado centraliza navegador, portal, avatar, e-mail,
WhatsApp e documentos financeiros na API. Valida bytes, extensão e MIME em worker
limitado, impõe 25 MiB por arquivo e preserva os limites menores dos buckets
(10 MiB; avatar 2 MiB). Scanner indisponível recusa o armazenamento. Uploads
privilegiados usam comprovante de varredura curto, ligado ao caminho, tamanho
e SHA-256. A segunda migration fecha gravações diretas e exige esse comprovante
também dos produtores com service role. Outros buckets do Supabase compartilhado
permanecem fora desse controle.

Validação local: **132 testes da API**, **58 testes Edge** sem rede/ambiente,
**41 arquivos e 1.570 asserções SQL**, reversão/reaplicação, typechecks/builds,
HTTP de portal/credenciais e limites concorrentes. Inclui arquivo infectado,
scanner offline, executável disfarçado, HTML/SVG, MIME incompatível, limites de
multipart, token revogado, tenant estrangeiro, recibo consumido uma única vez e
limpeza dos arquivos novos quando a publicação falha. O corpo das server functions
é limitado antes da desserialização, inclusive em transferências chunked.

O complemento de autorização da galeria preserva o módulo `figurinhas.create`
independentemente de `tickets.edit`, com quatro asserções adicionais no CI.

**Esse lote de aplicação e suas duas migrations ainda não estão em produção.**
O operador confirmou em 22/10 que áudio/vídeo e gravações de voz do WhatsApp
devem ser preservados. A validação foi ampliada para os contêineres de mídia,
mantendo 25 MiB e antivírus; oito testes adicionais cobrem OGG/Opus, voz WebM,
vídeos MP4/WebM, M4A/WAV e recusa de áudio infectado.
A função Edge também precisa receber APTICKET_API_URL
e ser publicada junto dos novos produtores. Sequência preparada:
`20261022162436` → API → web/Edge → `20261022163913`. Reversão: retirar primeiro
o fechamento de Storage; depois reverter produtores e o contrato de recibos.

## PostgreSQL compartilhado — janela e recuperação

Janela autorizada: **22/10 às 23:00 até 23/10 às 05:00, America/Sao_Paulo**.
Produção permanece em 17.6 antes da janela. Destino testado:
`supabase/postgres:17.11.0.006@sha256:c141fd17ac6a76c4323e90b3aee8ff1a23d2e89e547c2b963cfadc309c079cc2`.

- Backup físico do cluster completo verificado com pg_verifybackup, incluindo
  checksums e WAL. Manifesto SHA-256:
  `5c2af52082c9536d473b58dbb802edd631615827f07d4e26f9280c6207db3f76`.
- Restauração real em 17.11, sem rede/portas, cron desabilitado. Confirmadas
  118 tabelas APTicket, 118 com RLS, onze bancos e decriptação dos seis registros
  do Vault, retornando somente contagens. A chave raiz foi preservada somente
  no servidor; nenhum segredo ou dado de cliente foi baixado à estação.
- Ensaio do procedimento completo: backup a frio, atualização e validação.
  Outro ensaio provocou falha após uma gravação em 17.11, voltou aos binários
  17.6 e confirmou que a gravação permaneceu. A reversão automática troca
  apenas os binários e mantém o PGDATA atual; não restaura snapshot antigo
  depois que clientes possam ter retomado gravações.
- Preflight dos onze bancos: nenhuma extensão ltree/btree_gist, divergência de
  collation ou referência SQL detectada às cifras PGP legadas citadas no aviso
  do fornecedor. Nenhum tablespace externo. Esses checks serão repetidos na janela.
- Evidências e backup persistentes em
  `/home/administrador/backups/apticket/postgres-maint-20261022`, diretório 0700,
  arquivos sensíveis restritos. O procedimento cria **novo backup a frio** na
  janela, incluindo o volume da chave/configuração; confere espaço, manifesto
  previamente restaurado, imagem e mounts antes de parar somente o banco.
  Depois confere banco/Vault, API, web, PostgREST, Auth e Storage.

Procedimento versionado: [manutenção](../../scripts/security/postgres-minor-maintenance.py)
e [lançador da janela](../../scripts/security/run-postgres-window.py). O lançador
confere hashes dos arquivos, respeita o fuso do host e remove sua única entrada
de cron antes de executar. Não instala backup recorrente. O resultado da janela
deve ser conferido no status protegido do servidor; preparação/agendamento não
equivalem à atualização concluída.

**Agendamento confirmado em 22/10 às 17:25:27Z:** cron ativo, uma única entrada
da janela, hashes dos dois scripts conferidos e demais entradas preservadas.
Código do procedimento: `428f99e`. O início será às 23h de Brasília;
`scheduled-status.log` e os diretórios de execução nessa área persistente
registrarão conclusão ou reversão. Nenhuma reinicialização do banco de produção
foi feita durante a preparação.

O caminho da área remota de backup manual ainda foi solicitado ao operador;
nenhuma cópia externa nova foi atestada. A cópia local persistente e os ensaios
acima estão concluídos. Automação recorrente/PITR fica para o trabalho futuro
informado pelo operador.

Referências: [compatibilidade entre versões menores do PostgreSQL](https://www.postgresql.org/docs/17/upgrading.html)
e [mudanças da versão Supabase 17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
