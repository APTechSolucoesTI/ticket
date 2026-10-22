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
- O [CI final `7e762ca`](https://github.com/APTechSolucoesTI/ticket/actions/runs/39833221291)
  aprovou os cinco jobs: aplicação, dependências, segredos, isolamento de sessão
  e SQL completo. O total com a fronteira de uploads passou a **41 arquivos e
  1.574 asserções SQL**, além das quatro verificações de backfill.
- Avisos atualizados no catálogo durante o lote voltaram a sinalizar DOMPurify
  e ip-address. Foram fixados DOMPurify **3.4.17** e ip-address **10.7.4** no
  workspace/lockfile. O audit passou de quatro avisos para zero, incluindo
  ferramentas de desenvolvimento; sanitização HTML e regressão SMTP/TLS passaram
  sem envio de e-mail. Referências: [DOMPurify 3.4.17](https://github.com/cure53/DOMPurify/releases/tag/3.4.17)
  e [ip-address 10.7.4](https://github.com/beaugunderson/ip-address/releases/tag/v10.7.4).

## SEC-09 — antivírus e fronteira de uploads em produção

O serviço privado de ClamAV está implantado, saudável, sem porta publicada,
com assinaturas persistentes, memória limitada a 4 GiB e imagem fixada por digest.
O teste real de protocolo aceitou bytes sintéticos limpos e recusou EICAR.
Não foram enviados arquivos de clientes nem malware real ao scanner.

O lote de aplicação publicado centraliza navegador, portal, avatar, e-mail,
WhatsApp e documentos financeiros na API. Valida bytes, extensão e MIME em worker
limitado, impõe 25 MiB por arquivo e preserva os limites menores dos buckets
(10 MiB; avatar 2 MiB). Scanner indisponível recusa o armazenamento. Uploads
privilegiados usam comprovante de varredura curto, ligado ao caminho, tamanho
e SHA-256. A segunda migration fecha gravações diretas e exige esse comprovante
também dos produtores com service role. Outros buckets do Supabase compartilhado
permanecem fora desse controle.

Validação local e CI: **132 testes da API**, **58 testes Edge** sem rede/ambiente,
**41 arquivos e 1.574 asserções SQL**, reversão/reaplicação, typechecks/builds,
HTTP de portal/credenciais e limites concorrentes. Inclui arquivo infectado,
scanner offline, executável disfarçado, HTML/SVG, MIME incompatível, limites de
multipart, token revogado, tenant estrangeiro, recibo consumido uma única vez e
limpeza dos arquivos novos quando a publicação falha. O corpo das server functions
é limitado antes da desserialização, inclusive em transferências chunked.

O complemento de autorização da galeria preserva o módulo `figurinhas.create`
independentemente de `tickets.edit`, com quatro asserções adicionais no CI.

O operador confirmou em 22/10 que áudio/vídeo e gravações de voz do WhatsApp
devem ser preservados. A validação foi ampliada para os contêineres de mídia,
mantendo 25 MiB e antivírus; oito testes adicionais cobrem OGG/Opus, voz WebM,
vídeos MP4/WebM, M4A/WAV e recusa de áudio infectado.

Publicação concluída em produção, na ordem `20261022162436` → API → web/Edge
→ `20261022163913`, após o CI aprovado:

- Migration de contrato `20261022162436`, registrada transacionalmente.
  SHA-256 do SQL canônico: `82db47c029f7a884a9b7ae59f6eb3ff796e83c38367ec1bbc7e40f0161eacc76`.
- API e frontend no commit `7e762ca750a1c689d996d8b812be7adf43dd3bb1`,
  via GitHub → Dokploy. Deployments `done`, criados respectivamente em
  `2026-10-22T18:45:55.280Z` e `2026-10-22T18:47:31.529Z`; Swarm concluído,
  novos containers e healthchecks HTTP 200 conferidos.
- Edge `client-documents-upload` e helper de corpo limitado publicados a partir
  desse checkout. `APTICKET_API_URL` configurado no runtime; somente o serviço
  de funções foi recriado. A função recusou a requisição sem identidade válida.
  O multipart conta bytes durante a leitura pelo parser, evitando uma segunda
  cópia integral do corpo tanto no web como no Edge.
- Migration de fechamento `20261022163913`, aplicada e registrada em
  `2026-10-22T18:50:28Z`. SHA-256 canônico:
  `bd32d57429aa8d43d916d2d7ebeb42917d3a8dc25e982d7f187944e8e666801f`.
  Duas policies restritivas e o trigger estão ativos. A tabela privada tem RLS;
  o owner do trigger não é superusuário. A criação de recibos permanece exclusiva
  de service role, sem EXECUTE para anon/authenticated.

Teste real após o fechamento, somente com conteúdo sintético: upload pela API
**201**; URL assinada **200**, com os bytes exatos; tentativa de upload direto
com service role sem recibo **403**; arquivo padrão EICAR pela API **400**.
Os objetos sintéticos foram removidos e a contagem residual foi zero.
HTTPS público respondeu **200**, com certificado validado, CSP com nonce,
HSTS e nosniff. Não foram enviados e-mails ou mensagens reais.

O ClamAV verifica novos anexos destes fluxos; não foi executada varredura geral
dos discos nem reprocessamento de arquivos históricos. Reversão: retirar primeiro
o fechamento de Storage; depois reverter produtores e o contrato de recibos.
O schema anterior, logs e scripts de reversão estão na área protegida de rollout
do servidor. Os backups anteriores de compose/env e da função Edge também foram
preservados. O banco de produção não foi reiniciado nesse rollout.

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

**Agendamento atualizado em 22/10, preflight às 18:32:01Z:** cron ativo, uma única
entrada da janela, hashes dos três scripts conferidos e demais entradas preservadas.
Código do procedimento publicado em `33fe31d`; os commits seguintes não alteram
esses scripts. O início será às 23h de Brasília;
`scheduled-status.log` e os diretórios de execução nessa área persistente
registrarão conclusão ou reversão. Nenhuma reinicialização do banco de produção
foi feita durante a preparação.

O destino autorizado `/dev/backup` foi confirmado como montagem CIFS da área
remota `//192.168.3.52/aptech/Banco`. O pacote de recuperação, incluindo o backup
físico, a chave do Vault e a configuração necessária, foi cifrado com AES-256
antes da cópia. A integridade foi conferida por SHA-256 do arquivo remoto e por
decriptação completa, sem gravar o conteúdo em claro na área remota:

- Arquivo: `/dev/backup/APTicket/postgres-maint-20261022/prepared-recovery-bundle-8a774e3c5dbf.tar.gpg`.
- Tamanho: 779.602.021 bytes.
- SHA-256 cifrado: `f235a1074e0949383b6a791dfb2c1ab53dbdcf95b6c209386b928b8410e62db7`.
- SHA-256 do pacote recuperado: `4a089b7ae3f363db0c01a89e548d0ae49379be826c9f31aae489950ed6779581`.

A nova chave de cifração do backup permanece restrita no servidor e tem uma
cópia independente protegida pelo DPAPI do usuário Windows, fora do repositório.
Isso não transfere a chave do Vault nem dados de clientes à estação. O procedimento
da janela exige **outro backup a frio e sua cópia externa cifrada e conferida**
antes de trocar a imagem do PostgreSQL. Falha de cópia ou verificação interrompe
a atualização. [Cópia cifrada e verificação](../../scripts/security/copy-maintenance-backup.py).
Automação recorrente/PITR fica para o trabalho futuro informado pelo operador.

Referências: [compatibilidade entre versões menores do PostgreSQL](https://www.postgresql.org/docs/17/upgrading.html)
e [mudanças da versão Supabase 17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
