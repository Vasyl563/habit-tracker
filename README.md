# Habit Tracker with Friends

Course project for **Backend for Frontend Developers** (Lessons 7–14) — one continuous
backend that grows a layer each week. Theme 05: personal habit tracking, daily check-ins
with streaks, one-way follows and an activity feed with per-habit visibility.

> 🇺🇦 Навчальна шпаргалка з поясненням кожного шару на прикладі цього коду:
> [`docs/shpargalka.md`](docs/shpargalka.md).

## Status by lesson

| Lesson | Layer | Where |
| --- | --- | --- |
| **L7** | Drizzle schema, migrations, seed | `packages/db` |
| **L8** | oRPC contract, Zod on every input, offset + cursor pagination, filters/sort whitelist, DTO mappers, Redis cache-aside, OpenAPI docs | `packages/types`, `apps/api/src/modules/*`, `apps/api/src/lib/{cache,cursor}.ts` |
| **L9** | Error hierarchy + one envelope, global handler, retry/backoff/jitter, sliding-window rate limit, Pino + request id, Sentry hooks | `apps/api/src/lib/{errors,rate-limit,orpc}.ts`, `apps/api/src/middleware/*`, `packages/{shared,logger}` |
| **L10** | better-auth (sessions, email+password, GitHub), ownership checks, CORS | `packages/auth`, `apps/api/src/middleware/session.ts` |
| **L11** | BullMQ queues + `apps/worker`, transactional outbox, notification fan-out, SSE, email (Mailpit/Resend) | `packages/queues`, `apps/worker`, `apps/api/src/modules/{sse,notifications}` |
| **L12** | MinIO presigned upload, streaming download, magic-byte worker, Stripe Payment Intent + HMAC-verified idempotent webhook | `packages/storage`, `apps/api/src/modules/{files,billing,webhooks}`, `apps/worker/src/files` |
| **L13** | Multi-stage Dockerfiles (turbo prune), full compose stack, GitHub Actions CI/release/migrate | `apps/*/Dockerfile`, `docker-compose.yml`, `.github/workflows` |
| **L14** | Railway deploy config: honest `/health` gate, `preDeployCommand` migrations, PORT contract, SPA served by the api (one origin), Railway-aware Sentry release/env | `apps/api/railway.json`, `apps/worker/railway.json`, `apps/api/Dockerfile` |

## Stack

Turborepo + pnpm · TypeScript strict · Hono + **oRPC** (contract-first, OpenAPI + RPC) · Drizzle ORM +
drizzle-kit · PostgreSQL · Redis (ioredis) · BullMQ · better-auth · Zod v4 · Pino · MinIO / S3 SDK ·
Stripe · Vite + React (client) · Vitest · Biome · Docker Compose · GitHub Actions.

## Layout

```
apps/
  api/      Hono + oRPC HTTP API (modular monolith: controller → service → repository per module)
  worker/   BullMQ consumers: email, event fan-out (notifications/SSE), file processing, outbox poller
  web/      minimal React client — typed oRPC client, better-auth client, SSE badge, presigned upload
packages/
  db/       Drizzle schema (per-lesson migrations), client, seed/reset, migrator, test utils
  types/    Zod schemas + DTO types + the oRPC contract shared by api and web
  shared/   retry/backoff, date + streak math, env parsing
  logger/   Pino factory (JSON in prod, pretty in dev, PII redaction)
  redis/    ioredis factory (general / bullmq / subscriber) + pub/sub channel names
  queues/   BullMQ queue definitions, job schemas, domain event schemas
  auth/     better-auth instance on our Drizzle tables
  storage/  S3/MinIO wrapper: presign PUT/GET, head, stream, put, delete
```

## Prerequisites

Node ≥ 20 (22 recommended), pnpm 10, Docker.

## Run it locally

```bash
pnpm install
cp .env.example .env               # defaults work with docker compose as-is

pnpm db:up                         # postgres :5433, redis :6380, minio :9000/:9001, mailpit :8025
pnpm db:migrate                    # apply migrations
pnpm db:seed                       # 24 users, 41 habits, ~1000 check-ins… password: Password123!

pnpm dev                           # api :3005 · worker · web :5173  (turbo)
```

Open http://localhost:5173 (sign in as `ada@example.com` / `Password123!`),
API docs at http://localhost:3005/v1/docs, mail inbox at http://localhost:8025.

Individual processes: `pnpm --filter @habit-tracker/api start`, `…/worker start`, `…/web dev`.

## Environment

Every variable is documented in [`.env.example`](.env.example) and validated with Zod at boot
(`apps/api/src/config/env.ts`, `apps/worker/src/config/env.ts`). Optional integrations:
`GITHUB_CLIENT_ID/SECRET` (OAuth callback `${API_URL}/api/auth/callback/github`),
`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (`stripe listen --forward-to localhost:3005/webhooks/stripe`),
`RESEND_API_KEY` (`EMAIL_PROVIDER=resend`), `SENTRY_DSN`. The web client reads `VITE_STRIPE_PUBLISHABLE_KEY`.

## HTTP surface

| Path | What |
| --- | --- |
| `GET /health` | liveness + postgres/redis checks (used by Docker `HEALTHCHECK`) |
| `/api/auth/*` | better-auth: sign-up/in/out, session, verify email, reset password, GitHub OAuth |
| `/v1/*` | REST-style OpenAPI surface of the oRPC router (`/v1/docs`, `/v1/openapi.json`) |
| `/rpc/*` | oRPC protocol used by the typed web client |
| `GET /sse/stream` | Server-Sent Events: unread count, notifications, file progress (session-guarded) |
| `GET /v1/files/:id/content` | streaming download from object storage |
| `POST /webhooks/stripe` | HMAC-verified, idempotent Stripe webhook |

Every error, on every route, has the same envelope: `{ code, message, details? }`.

## Tests

```bash
pnpm test                # unit: shared (retry, streaks), types (schemas), api (cursor, HMAC), worker (templates)
pnpm test:integration    # api against real Postgres + Redis (separate DB habit_tracker_test, Redis db 9)
```

Integration suites drive the Hono app in-process and cover auth, habits CRUD + visibility, the atomic
check-in (409 on duplicate day, streak recompute, **5 concurrent check-ins → exactly one 201**),
follows/feed/profile, the Stripe webhook (signature, success path, redelivery), rate limiting, health,
request ids and OpenAPI generation.

## Containers & CI

```bash
pnpm stack:up            # docker compose --profile app: migrate → api → worker (+ infra)
pnpm stack:down
```

`apps/api/Dockerfile` / `apps/worker/Dockerfile`: multi-stage with `turbo prune`, pinned Node + pnpm,
non-root user, `HEALTHCHECK`. Workflows: `ci.yml` (lint, typecheck, unit, integration with service
containers), `release.yml` (multi-arch images → GHCR tagged `:<sha>`, `:main`, `:latest`),
`migrate.yml` (manual, environment-gated migrations with a Postgres advisory lock).

## Deploy to Railway (L14)

The api image also serves the built SPA (`WEB_DIST_DIR`), so **one service = app + API on one
origin** — cookies and CORS just work. Config-as-code lives in `apps/api/railway.json` and
`apps/worker/railway.json` (Dockerfile builder, `preDeployCommand` migrations, `/health` gate).

```bash
railway login
railway init                        # project + the production environment
railway add --database postgres
railway add --database redis
```

Then in the dashboard create two services from this GitHub repo — **api** and **worker** — and set
each service's *Config file path* to its `railway.json`. Variables (use references, never paste):

```
# api + worker
DATABASE_URL          = ${{Postgres.DATABASE_URL}}
REDIS_URL             = ${{Redis.REDIS_URL}}
API_URL               = https://${{RAILWAY_PUBLIC_DOMAIN}}     # api only
WEB_URL               = https://${{RAILWAY_PUBLIC_DOMAIN}}     # same origin — SPA is served by the api
BETTER_AUTH_SECRET    = <openssl rand -base64 32>
S3_* / EMAIL_* / STRIPE_* / SENTRY_DSN                          # see .env.example
```

Notes: for object storage deploy the MinIO template (reach it at `http://<minio>.railway.internal:9000`
as `S3_ENDPOINT`, its public URL as `S3_PUBLIC_ENDPOINT` — presigned URLs must be reachable by the
browser) or use any S3-compatible bucket (e.g. Cloudflare R2). For email set `EMAIL_PROVIDER=resend`
+ `RESEND_API_KEY` (there is no Mailpit in prod). `GIT_SHA`/Sentry release and environment are picked
up automatically from `RAILWAY_GIT_COMMIT_SHA` / `RAILWAY_ENVIRONMENT_NAME`.

Then: `railway domain` (or a custom domain + CNAME) → enable **backups** on the Postgres volume →
create a **staging** environment (its `railway.json` override also seeds demo data on deploy) →
rehearse a rollback (ship a broken deploy to staging, redeploy the previous deployment, time it).

Sample Log Explorer queries: `@level:error` · `@requestId:<id>` · `@msg:"request" @status:>=500`.

## Data model

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `users`, `user_settings` (1:1) | accounts, preferences | `email` UNIQUE; `plan` enum |
| `habits` | a user's habit | FK → users cascade; enums `schedule`, `visibility`; denormalised streak counters; CHECK streaks ≥ 0 |
| `check_ins` | one habit checked on one day | **UNIQUE (`habit_id`, `date`)**; keyset index (`created_at`, `id`) |
| `follows` (M:N) | one-way follow | composite PK; **CHECK** no self-follow |
| `sessions`, `accounts`, `verifications` | better-auth | `token` UNIQUE; (`issuer`,`account_id`) UNIQUE |
| `notifications`, `outbox` | in-app inbox, transactional outbox | UNIQUE (`event_id`,`user_id`); partial indexes on unread / unpublished |
| `files` | object-storage metadata | `key` UNIQUE; status enum |
| `payments`, `webhook_events` | Stripe audit + idempotency | `stripe_payment_intent_id` UNIQUE; event id PK |

Visibility rules: `public` → anyone signed in · `friends` → mutual follow · `private` → owner only
(enforced in SQL for the feed and in the service for direct reads).
