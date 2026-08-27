# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# apps/api image · multi-stage (L13/L14)
#
#   pruner     → `turbo prune` = the slice of the monorepo api + web need
#   installer  → prod dependencies from the pruned lockfile (cached layer)
#   webbuilder → full install (vite is a devDep) + `vite build` → apps/web/dist
#   runtime    → alpine + non-root + HEALTHCHECK; the api also serves the
#                built SPA from WEB_DIST_DIR — one origin for app + API (L14)
#
#   docker build -f apps/api/Dockerfile -t habit-tracker-api .
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=22.21.1
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# pin the package manager — reproducible installs six months from now
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# ── 1. prune the monorepo to what api + web need ─────────────────────────────
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.10.2 prune @habit-tracker/api @habit-tracker/web --docker

# ── 2. prod dependencies (manifests first → cache survives source edits) ─────
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod
COPY --from=pruner /app/out/full/ ./

# ── 3. build the SPA (needs devDeps: vite, @vitejs/plugin-react) ─────────────
FROM base AS webbuilder
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ ./
# VITE_* vars are baked at build time (e.g. the Stripe publishable key)
ARG VITE_STRIPE_PUBLISHABLE_KEY=
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
RUN pnpm --filter @habit-tracker/web build

# ── 4. runtime ───────────────────────────────────────────────────────────────
FROM base AS runtime
ARG GIT_SHA=dev
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
# absolute: the start script's cwd is /app/apps/api (pnpm --filter)
ENV WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=installer --chown=node:node /app ./
COPY --from=webbuilder --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 3005
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3005/health || exit 1
CMD ["pnpm", "--filter", "@habit-tracker/api", "start"]
