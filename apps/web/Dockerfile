# Build a partir da RAIZ do monorepo (contexto = .. a partir daqui), porque
# o web depende de packages/shared-types via pnpm workspace — precisa do
# pnpm-workspace.yaml e do lockfile único na raiz pra instalar corretamente.
#
# NITRO_PRESET=node-server é o que faz esse build virar um servidor Node de
# verdade em vez do preset default do nitro/vite aqui (cloudflare-module) —
# sem isso o `vite build` produz saída pra Cloudflare Workers, que rodando
# como container simples vira só os assets estáticos, sem servidor real
# atrás (era essa a causa raiz do bloqueio de produção antigo).

FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: só manifests primeiro, pra cache de camada Docker sobreviver
# a mudanças de código sem reinstalar tudo ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter web...

# ---- build: código de verdade entra aqui ----
FROM deps AS build

COPY apps/web apps/web
COPY packages/shared-types packages/shared-types

ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

ENV NITRO_PRESET=node-server

RUN pnpm --filter web build

# ---- runtime: só o output do nitro, sem devDependencies/toolchain/fonte ----
FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/web/.output ./.output

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s \
  CMD ["node", "-e", "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
