# Foto em Meu Perfil

Em Meu Perfil, selecione **Adicionar foto** ou **Alterar foto**, confira a prévia e clique em **Salvar foto**. São aceitos JPG, PNG e WebP de até 2 MB. **Cancelar** descarta a seleção; **Remover foto** volta às iniciais. A imagem salva aparece também no cabeçalho e permanece depois de recarregar a página.

As server functions `uploadMyAvatar` e `removeMyAvatar` validam a sessão e derivam usuário/tenant da autenticação. O envio valida tamanho, tipo e assinatura do arquivo. A gravação usa uma condição sobre a foto anterior para evitar sobrescrever alterações simultâneas. Em falha de gravação, o arquivo recém-enviado é removido; após substituição, o anterior é limpo. Erros de envio preservam a foto existente e permitem tentar novamente.

O campo existente `apticket.profiles.avatar_url` guarda o caminho `tenant/user/uuid.ext`; URLs HTTPS legadas continuam aceitas na leitura. Não há alteração de campos de contato ou senha. O bucket `apticket-profile-avatars` é privado, com URLs assinadas válidas por uma hora. As políticas restritivas isolam cada usuário e bloqueiam gravações diretas mesmo se outros aplicativos da instalação compartilhada possuírem políticas amplas de Storage. As funções de servidor usam a chave de serviço somente depois de validar a identidade e restringir a consulta ao próprio perfil. O cache da foto inclui o ID do usuário.

Migration: `supabase/migrations/20261014155523_profile_avatar_storage.sql`. É idempotente e deve ser aplicada como proprietário do banco, em transação, registrando a versão no histórico do Supabase. A implantação utiliza o fluxo GitHub → Dokploy. Para reverter a aplicação, restaure o commit anterior e preserve o bucket privado e seus arquivos; não remova o bucket sem revisar as fotos já enviadas.

Verificações:

- `node --test scripts/test-profile-avatar.mjs`: validações de arquivo e pertencimento do caminho.
- `supabase/tests/profile_avatar_storage_test.sql`: 11 verificações transacionais de privacidade, isolamento, usuários inativos, proteção contra policies amplas e compatibilidade dos demais buckets; pré-implantação também aplica a migration duas vezes.
- `scripts/test-profile-photo-ui.mjs`, com `PLAYWRIGHT_MODULE` apontando para Playwright: frontend e server functions reais com Supabase HTTP isolado; prévia, cancelar, enviar, recarregar, substituir, remover, MIME disfarçado, tentativa de alterar outro usuário e falhas de Storage/banco. Fluxo validado em 1440, 768 e 390 px; evidências locais em `artifacts/profile-photo/`.
- Lint dos arquivos alterados e build de produção. O typecheck global mantém os erros preexistentes fora dos arquivos desta alteração.

Validação manual: enviar uma foto real no próprio perfil, recarregar a página e conferir a imagem no cabeçalho. Os testes não alteram fotos de usuários existentes.
