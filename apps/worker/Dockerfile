# syntax=docker/dockerfile:1.7
# apps/worker image · same recipe as apps/api, pruned for @habit-tracker/worker.
# No port, no HEALTHCHECK on HTTP — BullMQ workers report health through logs
# and (in production) Bull Board / metrics.
ARG NODE_VERSION=22.21.1
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.10.2 prune @habit-tracker/worker --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
# no BuildKit cache mount: Railway's builder requires service-scoped cache ids,
# and GitHub Actions caches whole layers anyway
RUN pnpm install --frozen-lockfile --prod
COPY --from=pruner /app/out/full/ ./

FROM base AS runtime
# empty default: at runtime the app falls back to RAILWAY_GIT_COMMIT_SHA;
# CI passes the real sha as a build arg
ARG GIT_SHA=
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=installer --chown=node:node /app ./
USER node
CMD ["pnpm", "--filter", "@habit-tracker/worker", "start"]
