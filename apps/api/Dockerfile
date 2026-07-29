# syntax=docker/dockerfile:1
#
# Builds and runs @zentuva/api. Build context must be the monorepo root, e.g.:
#   docker build -f apps/api/Dockerfile .
# (docker-compose.production.yml already does this.)
#
# Not used in day-to-day development — apps/api runs directly on the host via `pnpm dev`.
# See docs/development/local-development.md.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @zentuva/api run prisma:generate
RUN pnpm exec turbo run build --filter=@zentuva/api...

FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
