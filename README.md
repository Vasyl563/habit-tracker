# Habit Tracker with Friends

Course project (Lessons 7–14) — one continuous backend that grows a layer each
week. **L7 milestone:** the monorepo boots, has a Drizzle schema, a
version-controlled migration, and a seed script that populates real data.

## Stack (shared baseline)

- **Monorepo:** Turborepo + pnpm workspaces
- **Language:** TypeScript (strict), Node 20+
- **Database:** PostgreSQL (Docker Compose) + **Drizzle ORM** + drizzle-kit migrations
- **HTTP:** Hono (oRPC arrives in a later lesson)
- **Validation:** Zod (arrives with the API in L8)

## Layout

```
habit-tracker/
├── docker-compose.yml          # local Postgres (host port 5433)
├── turbo.json · pnpm-workspace.yaml · tsconfig.base.json
├── apps/
│   └── api/                    # minimal Hono API (boots, serves seeded data)
└── packages/
    ├── db/                     # Drizzle schema, migrations, client, seed  ← L7 core
    │   ├── src/schema.ts        # tables + enums + constraints + relations
    │   ├── src/client.ts        # node-postgres connection
    │   ├── src/seed.ts          # realistic data + round-trip SELECT
    │   ├── drizzle.config.ts
    │   └── drizzle/             # generated migration SQL (committed)
    └── types/                  # domain types inferred from the schema
```

## Data model (L7)

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `users` | accounts | `email` UNIQUE |
| `habits` | a user's habit | FK → users (cascade); enums `schedule`, `visibility`; `weekdays int[]`; streak counters; index on `user_id` |
| `check_ins` | one habit checked on one day | **UNIQUE (`habit_id`, `date`)** — one check-in per day |
| `follows` | one-way follow | composite PK (`follower_id`, `followee_id`); **CHECK** `follower_id <> followee_id` (no self-follow) |

## Prerequisites

- Node 20+ (`nvm use 22`), pnpm 10, Docker running.

## Run it

```bash
pnpm install

pnpm db:up          # start Postgres in Docker (waits until healthy)
pnpm db:generate    # schema.ts -> SQL migration (offline)
pnpm db:migrate     # apply migrations to Postgres
pnpm db:seed        # insert test data + print a round-trip SELECT

# see it over HTTP:
pnpm --filter @habit-tracker/api start   # http://localhost:3005/users
```

Other: `pnpm db:studio` (Drizzle Studio), `pnpm typecheck`, `pnpm db:down`.

`DATABASE_URL` lives in `.env` (git-ignored); `.env.example` is the template.

## Project roadmap

| Lesson | Adds |
| --- | --- |
| **L7** | Drizzle schema + first migration + seed (**this**) |
| L8 | API patterns — pagination, filtering, sorting, Zod, Redis caching |
| L9 | Error handling — taxonomy, global handler, rate limiting |
| L10 | Auth — JWT, CORS, social provider |
| L11 | Event-driven — BullMQ queues, SSE notifications |
| L12 | File storage — MinIO presigned URLs, webhooks |
| L13 | Containerisation — Dockerfile, CI |
| L14 | Deployment — Railway, Sentry, capstone defence |
