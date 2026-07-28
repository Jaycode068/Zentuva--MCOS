# syntax=docker/dockerfile:1
#
# Builds and runs @zentuva/web. Build context must be the monorepo root, e.g.:
#   docker build -f apps/web/Dockerfile .
# (docker-compose.yml already does this.)

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm exec turbo run build --filter=@zentuva/web...

FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@zentuva/web", "start"]
