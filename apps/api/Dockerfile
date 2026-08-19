# Build sempre a partir da raiz do monorepo.
# Dokploy:
# Build Path: /
# Dockerfile: apps/api/Dockerfile
# Docker Context Path: .

FROM node:22-bookworm-slim AS base

RUN corepack enable

WORKDIR /repo


# --------------------------------------------------
# DEPENDÊNCIAS
# --------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN pnpm install --frozen-lockfile --filter api...


# --------------------------------------------------
# BUILD
# --------------------------------------------------
FROM deps AS build

COPY apps/api apps/api
COPY packages/shared-types packages/shared-types

RUN pnpm --filter api build


# --------------------------------------------------
# RUNTIME
# --------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

RUN corepack enable

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN pnpm install --frozen-lockfile --prod --filter api...

COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/packages/shared-types packages/shared-types

WORKDIR /repo/apps/api

EXPOSE 3001

CMD ["node", "dist/main.js"]
