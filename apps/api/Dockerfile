# Build a partir da RAIZ do monorepo (infra/docker-compose.yml usa
# `context: ..`), porque a API depende de packages/shared-types via pnpm
# workspace — precisa do pnpm-workspace.yaml e do lockfile único na raiz
# pra instalar corretamente.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: só manifests primeiro, pra cache de camada Docker sobreviver
# a mudanças de código sem reinstalar tudo ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter api...

# ---- build: código de verdade entra aqui ----
FROM deps AS build
COPY apps/api apps/api
COPY packages/shared-types packages/shared-types
RUN pnpm --filter api build

# ---- runtime: só o necessário pra rodar, sem devDependencies/toolchain ----
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --prod --filter api...
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY packages/shared-types packages/shared-types

WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
