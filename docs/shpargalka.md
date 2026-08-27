# Шпаргалка з бекенду · Habit Tracker with Friends (L7 → L14)

> Для кого: для фронтендера, який «в беці майже 0». Це не переказ слайдів —
> це пояснення **на прикладі коду в цьому репозиторії**. Кожен розділ:
> *що це* → *навіщо* → *де в коді* → *як перевірити руками*.
> Читай зверху вниз один раз, потім користуйся як довідником.

---

## 0. Карта репозиторію (де що лежить)

```
habit-tracker/
├─ apps/
│  ├─ api/        HTTP-сервер (Hono + oRPC). Приймає запити, перевіряє, віддає JSON.
│  ├─ worker/     Фоновий процес (BullMQ). Листи, нотифікації, обробка файлів. Без HTTP.
│  └─ web/        Мінімальний React-клієнт (Vite) — доказ, що типи наскрізні.
├─ packages/
│  ├─ db/         Drizzle-схема, міграції, seed, підключення до Postgres.   (L7)
│  ├─ types/      Zod-схеми + oRPC-контракт: «договір» між api і web.       (L8)
│  ├─ shared/     Чисті хелпери: retry, дати, підрахунок streak, parseEnv.
│  ├─ logger/     Pino (структуровані логи).                                 (L9)
│  ├─ redis/      Фабрика ioredis-з'єднань + назви pub/sub-каналів.         (L8/L9/L11)
│  ├─ queues/     Черги BullMQ + схеми доменних подій.                       (L11)
│  ├─ auth/       better-auth поверх нашої Drizzle-схеми.                     (L10)
│  └─ storage/    Обгортка над S3/MinIO: presigned URL, стрім, head.         (L12)
├─ docker-compose.yml   Postgres, Redis, MinIO, Mailpit (+ api/worker/migrate у профілі app)
├─ apps/api/railway.json · apps/worker/railway.json   конфіг деплою на Railway (L14)
├─ .github/workflows/   CI (lint/typecheck/tests), release (образи в GHCR), migrate
└─ docs/shpargalka.md   ← ти тут
```

**Правило одного напрямку залежностей:** `apps/*` залежать від `packages/*`,
пакети — тільки від «нижчих» пакетів (`db` → `shared`, `auth` → `db`, …).
Пакет ніколи не імпортує з `apps/`.

---

## 1. Велика картина: як летить один запит

Візьмімо `POST /v1/habits/{id}/check-ins` («відмітити звичку сьогодні»).

```
Браузер ──fetch──► Hono (apps/api/src/app.ts)
   │  1. requestId        middleware/request-id.ts     — кожен запит отримує x-request-id
   │  2. requestLogger    middleware/request-logger.ts — один рядок логу на запит
   │  3. cors             app.ts                       — дозволяємо тільки WEB_URL
   │  4. sessionLoader    middleware/session.ts        — читаємо cookie → сесія або null
   │  5. OpenAPIHandler   app.ts (/v1/*)               — знаходить процедуру в oRPC-роутері
   ▼
oRPC-процедура (modules/check-ins/check-ins.controller.ts)
   │  authed  → якщо сесії немає → 401
   │  rateLimited → 60 запитів/хв на юзера, інакше 429
   │  Zod валідує input за контрактом (packages/types) → інакше 400 VALIDATION_ERROR
   ▼
Service (check-ins.service.ts)   ← бізнес-правила живуть ТУТ
   │  транзакція: заблокувати звичку FOR UPDATE → INSERT check-in → перерахувати streak
   │  → оновити лічильники → записати подію в outbox → COMMIT
   ▼
Repository (check-ins.repository.ts, habits.repository.ts) ← знає SQL, не знає правил
   ▼
Postgres (packages/db)  — UNIQUE(habit_id, date) не пустить другий check-in за день (409)
```

Паралельно, **вже після відповіді клієнту**:

```
outbox (таблиця) ──poller (apps/worker/src/events/outbox-poller.ts)──► черга "events" (Redis)
   ──► events.worker.ts: якщо це milestone (3/7/30…) → рядок у notifications
        + Redis PUBLISH → api (lib/sse-hub.ts) → браузер отримує подію по SSE
        + якщо юзер дозволив — email у чергу "email" → email.worker.ts → Mailpit/Resend
```

**Три шари в кожному модулі (N-layer, L4):**

| Шар | Файл | Що знає | Чого НЕ робить |
|---|---|---|---|
| Controller | `*.controller.ts` | HTTP: input, context, який сервіс викликати | ніякої логіки, ніякого try/catch |
| Service | `*.service.ts` | правила: хто власник, що видно, коли 404, коли інвалідувати кеш | не знає про Hono/oRPC, не пише SQL |
| Repository | `*.repository.ts` | таблиці, JOIN, індекси, транзакції | не вигадує сенсу: повертає рядок або `null` |

Плюс `*.mapper.ts` — єдине місце, де рядок БД перетворюється на DTO (те, що бачить клієнт).

---

## 2. L7 · База даних, Drizzle, міграції

### Терміни простими словами
- **ORM** (Drizzle) — таблиці описані TypeScript-кодом; запити типізовані; помилка в назві колонки — це помилка компіляції, а не 3-тя ночі в проді.
- **Міграція** — файл із SQL, який змінює схему БД. Кожна зміна = новий файл у git. БД пам'ятає, які вже застосовані (таблиця `__drizzle_migrations`).
- **Транзакція** — «все або нічого»: кілька запитів, які або всі закомітяться, або всі відкотяться (`db.transaction(async (tx) => …)`; `throw` = ROLLBACK).
- **Індекс** — окрема структура, щоб `WHERE`/`ORDER BY` не сканували всю таблицю. Ставимо на FK-колонки і на те, чим фільтруємо/сортуємо.
- **Constraint** — правило, яке БД перевіряє сама: `UNIQUE`, `FOREIGN KEY`, `CHECK`, `NOT NULL`. Правило в БД надійніше за перевірку в коді (код можна обійти другим сервісом).

### Наша схема (`packages/db/src/schema/`)
| Файл | Таблиці | Цікаве |
|---|---|---|
| `users.ts` | `users`, `user_settings` (1:1) | `plan` (free/pro), `email_verified`, `image` |
| `habits.ts` | `habits`, `check_ins`, `follows` (M:N) | `UNIQUE(habit_id, date)`, `CHECK follower <> followee`, денормалізовані `current_streak/longest_streak/total_check_ins` |
| `auth.ts` | `sessions`, `accounts`, `verifications` | таблиці better-auth (L10) |
| `notifications.ts` | `notifications`, `outbox` | часткові індекси `WHERE read_at IS NULL` |
| `files.ts` | `files` | метадані, байти лежать у MinIO |
| `billing.ts` | `payments`, `webhook_events` | idempotency для вебхуків |
| `relations.ts` | тільки `relations()` | щоб `db.query.users.findMany({ with: { habits: true } })` працювало |

Типи сутностей виводяться зі схеми: `type Habit = typeof habits.$inferSelect` (`schema/index.ts`). Одне джерело правди.

### Міграції як історія проєкту (`packages/db/drizzle/`)
```
0000_silent_titania.sql          L7  — users, habits, check_ins, follows
0001_l8_api_layer.sql            L8  — user_settings, лічильники, індекси під list-ендпоїнти
0002_l10_auth.sql                L10 — sessions/accounts/verifications, users.email_verified/image
0003_l11_notifications_outbox    L11 — notifications, outbox
0004_l12_files_billing           L12 — files, payments, webhook_events, users.plan
0005_l8_keyset_ms_precision      L8  — timestamptz(3) для колонок-курсорів (див. §3, «баг, який ми спіймали»)
```
Порядок роботи завжди один: **редагуєш `schema/*.ts` → `pnpm db:generate` → читаєш SQL → комітиш → `pnpm db:migrate`**.

### Безпечні міграції в проді (слайди 16–17)
Додати `NOT NULL`-колонку в живу таблицю = блокування. Роби три кроки:
1) додай колонку **nullable**, 2) заповни (backfill) скриптом, 3) окремою міграцією постав `NOT NULL`.
Перейменування/видалення колонки — «спочатку деплой коду, який її не читає, потім drop».
У нас це проговорено в коментарях `packages/db/src/migrate.ts` (advisory lock) та в CI-джобі міграцій.

### Seed (`packages/db/src/seed.ts`)
Ідемпотентний: `TRUNCATE` → 24 юзери, 41 звичка, ~1000 check-in'ів, follows, нотифікації.
Streak'и порахував той самий `computeStreaks`, що й API — тому лічильники в БД узгоджені з даними.
Всі юзери входять з паролем `Password123!` (хеш зроблено функцією better-auth).
`pnpm db:reset` — «чиста БД» (обидва скрипти — вимога DoD L13).

### Перевір руками
```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm db:studio     # Drizzle Studio — подивитись таблиці очима
```

---

## 3. L8 · API patterns: пагінація, фільтри, DTO, Zod, кеш, OpenAPI

### Пагінація — два види, обидва в коді
| | Offset (`?limit=20&offset=40`) | Cursor / keyset (`?limit=20&cursor=eyJ0…`) |
|---|---|---|
| Для чого | каталоги, де є «сторінка 3» | стрічки/таймлайни, нескінченний скрол |
| Швидкість | падає на глибоких сторінках (`OFFSET 10000` читає 10020 рядків) | стала: індексний пошук від курсора |
| У нас | `habits.list`, `users.search`, `followers` | `feed.list`, `checkIns.list`, `notifications.list`, `files.list` |
| Код | `modules/habits/habits.repository.ts` (`limit/offset` + `count()`) | `lib/cursor.ts` + `keysetBefore()` у `check-ins.repository.ts` |

**Курсор** — це base64url від `{ t: createdAt, i: id }` останнього рядка. Запит наступної сторінки:
`WHERE (created_at, id) < (t, i) ORDER BY created_at DESC, id DESC LIMIT n+1`.
`id` як tiebreaker робить порядок повним, `+1` рядок каже, чи є наступна сторінка без `COUNT`.

**Баг, який ми спіймали (і виправили міграцією 0005):** JS `Date` має мілісекунди, а Postgres
`timestamptz` — мікросекунди. Курсор `.955` ніколи не дорівнював `.955123` у БД → друга сторінка порожня.
Рішення: колонки-курсори зробити `timestamptz(3)`. Запам'ятай — це класика.

### Динамічні фільтри та сортування без SQL-ін'єкцій
`habits.repository.ts`:
```ts
const clauses = [eq(habits.userId, userId), q.schedule ? eq(habits.schedule, q.schedule) : undefined, …];
where: and(...clauses)              // and() пропускає undefined
orderBy: SORT_COLUMNS[q.sortBy]     // ключ у білому списку, НІКОЛИ не рядок від юзера
```
Zod (`packages/types/src/schemas/habits.ts`) вже відкинув будь-який `sortBy`, якого нема в `HABIT_SORT_FIELDS`.
Перевір: `GET /v1/habits?sortBy=password` → `400 VALIDATION_ERROR`.

### DTO ≠ entity
Рядок БД (`Habit`) має службові поля; **DTO** (`HabitDto` у `packages/types`) — це обіцянка API.
Мапери (`*.mapper.ts`) — єдине місце перетворення. Дати в DTO — ISO-рядки (JSON не має типу Date).
Клієнт (`apps/web`) знає лише DTO — тому перейменування колонки в БД не ламає фронт.

### Zod — «вишибала на дверях»
TypeScript живе тільки на етапі компіляції; JSON із мережі — це `unknown`. Zod перевіряє **один раз, на вході**:
- `packages/types/src/schemas/*` — одна схема = валідація + TS-тип (`z.infer`) + OpenAPI.
- ідіоми: `.refine()` для крос-польових правил (weekly → потрібні weekdays), `.default()`, `.trim()`.
- env теж валідується Zod'ом при старті: `apps/api/src/config/env.ts` (помилка → процес не стартує).
- oRPC-плагін `ZodSmartCoercionPlugin` перетворює `?limit=20` (рядок) у число для GET-запитів.

### oRPC — контракт спочатку (contract-first)
`packages/types/src/contract.ts` описує кожну процедуру: HTTP-метод, шлях, input, output, коди помилок.
`apps/api/src/lib/orpc.ts`: `implement(contract)` — компілятор змусить реалізувати саме цей контракт.
`apps/api/src/router.ts` збирає модулі. Один роутер обслуговують два хендлери (`app.ts`):
- `/v1/*` — OpenAPIHandler: REST-подібні шляхи, curl-friendly, `/v1/docs` (Scalar UI), `/v1/openapi.json`;
- `/rpc/*` — RPCHandler: власний протокол для типізованого клієнта в `apps/web`.
Документація **згенерована** з тих самих Zod-схем — вона не може відставати від коду.

### Redis cache-aside (`apps/api/src/lib/cache.ts`)
```
app → Redis GET key → hit? віддай : (читай Postgres → Redis SET key EX ttl → віддай)
```
Інвалідація — найважча половина:
- **TTL** — усе протухає само (профіль 60 с, список звичок 30 с);
- **подієва через версію** — у ключі є `version` неймспейсу (`habits:v:<userId>`); будь-який запис робить `INCR` → усі старі ключі юзера миттєво «не ті» і просто доживуть TTL. Жодного `SCAN`/wildcard-delete.
Де: `habits.service.ts` (`list` + `invalidate`), `users.service.ts` (`profile` + `invalidateProfile`).
Помилка Redis **ніколи не ламає запит** — просто йдемо в БД (див. `try/catch` у `cache.ts`).
Що кешуємо: GET-и, які читають часто й змінюються рідко. Що ні: стрічку (персональна, змінюється щосекунди), будь-які POST.

### Перевір руками
```bash
# після pnpm dev (або pnpm --filter @habit-tracker/api start)
curl -s -c j.txt -H 'Content-Type: application/json' -X POST localhost:3005/api/auth/sign-in/email \
  -d '{"email":"ada@example.com","password":"Password123!"}' > /dev/null
curl -s -b j.txt 'localhost:3005/v1/habits?limit=2&sortBy=name'      # offset-пагінація
curl -s -b j.txt 'localhost:3005/v1/feed?limit=3'                    # cursor → nextCursor
open http://localhost:3005/v1/docs                                    # згенерована документація
```
У логах API (`LOG_LEVEL=debug`) видно `cache miss` → `cache hit`.

---

## 4. L9 · Помилки та надійність

### Дві категорії помилок
- **Операційні** (очікувані): юзер надіслав погані дані, ресурсу нема, конфлікт, третя сторона впала → маємо ім'я, статус, повідомлення для юзера.
- **Програмістські** (баги): `undefined is not a function`, забутий `await` → лог із стеком, Sentry, юзеру — загальний 500 без деталей.

### Ієрархія (`apps/api/src/lib/errors.ts`)
```
AppError(code)
└─ HttpException(status, code, message, details?)
   ├─ ValidationError 400   ├─ UnauthorizedError 401   ├─ ForbiddenError 403
   ├─ NotFoundError 404     ├─ ConflictError 409       ├─ UnprocessableError 422
   ├─ RateLimitError 429    ├─ PayloadTooLargeError 413 └─ UnsupportedMediaTypeError 415
```
Хто що кидає:
- middleware — 401/429 (`lib/orpc.ts`, `middleware/auth-rate-limit.ts`);
- service — 403/404/409/422 (правила);
- repository — лише переклад SQLSTATE → тип: `mapDbError()` (unique → 409, FK/CHECK → 400);
- controller — **нічого**, і жодного `try/catch`.

### Один глобальний обробник, одна форма відповіді
`{ code, message, details? }` — завжди. `code` — машинний (`UPPER_SNAKE`), `message` — для людини,
`details` — структурні дрібниці (масив Zod-issues, `retryAfterSeconds`…).
- Hono-роути: `middleware/error-handler.ts` (`app.onError`).
- oRPC-процедури: `errorBoundary` у `lib/orpc.ts` + `customErrorResponseBodyEncoder` в `app.ts`.
- 5xx і невідомі помилки → лог з `requestId` + Sentry (якщо `SENTRY_DSN`).
Що **ніколи** не потрапляє у відповідь: стек, SQL, шляхи файлів, секрети.
`400 vs 422`: 400 — форма/типи не ті (Zod); 422 — форма ок, але правило порушено («не можна відмітити майбутнє»).

### Retry з backoff + jitter (`packages/shared/src/retry.ts`)
Повторюємо тільки те, що може «саме полагодитись»: мережа, 5xx, 429. 4xx — ніколи.
Затримка росте експоненційно (`200 → 400 → 800 → … ≤ 4 с`), плюс **jitter** — випадкова частина,
щоб тисяча клієнтів не вдарила по серверу одночасно після збою. Використано в `packages/storage`
(виклики до S3) та у worker'і (SMTP). Тест: `packages/shared/src/retry.test.ts`.

### Rate limiting: sliding window у Redis (`apps/api/src/lib/rate-limit.ts`)
Sorted set на ключ `rl:<scope>:<key>`: додаємо запит із timestamp, видаляємо старші за вікно, рахуємо —
чотири команди в `MULTI/EXEC` (атомарно). Перевищення → `429` + заголовок `Retry-After`.
Де застосовано (не «всюди», а де болить): sign-in/sign-up/reset (по IP **і** по email — `middleware/auth-rate-limit.ts`),
створення check-in'ів (60/хв), presign (30/хв), checkout (5/хв) — усе через `rateLimited(scope, rule)` в `lib/orpc.ts`.

### Логи: Pino + correlation id
`packages/logger` — JSON у проді, красиво в dev, `redact` для паролів/cookie/токенів.
`middleware/request-id.ts` читає або генерує `x-request-id` і повертає його у відповіді;
`middleware/request-logger.ts` створює child-логер із цим id → кожен рядок запиту має той самий `requestId`.
Один рядок на запит: method, path, status, durationMs. Перший аргумент — об'єкт, другий — текст:
`logger.info({ userId, habitId }, "check-in created")`.

### Перевір руками
```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w '%{http_code} ' -H 'Content-Type: application/json' \
  -X POST localhost:3005/api/auth/sign-in/email -d '{"email":"x@y.z","password":"wrong"}'; done
# → 401 ×10, потім 429 (і Retry-After у заголовках)
curl -s -i localhost:3005/health | grep -i x-request-id
```

---

## 5. L10 · Автентифікація

### AuthN vs AuthZ
- **Автентифікація** — «хто ти?» (пароль, соцмережа). Робить better-auth.
- **Авторизація** — «що тобі можна?» (власник звички? чи видно чужу?). Робимо **ми, у сервісах**:
  `habits.service.ts → getOwned()` (403 для чужого при записі), `getVisible()`/`canView()` (404 для невидимого при читанні — навмисно 404, а не 403, щоб не підтверджувати існування).

### Сесії vs JWT — чому в нас сесії
- **Сесія**: рядок у таблиці `sessions`; cookie несе лише токен-посилання. Відкликати = видалити рядок. Просто й чесно.
- **JWT**: без походу в БД, зате не відкликати до `exp`, а payload читає хто завгодно (base64, не шифрування).
better-auth дає сесійний cookie `habit.session_token`: `HttpOnly` (JS не читає — захист від XSS),
`SameSite=Lax` (захист від CSRF), `Secure` у проді. Access-токен у `localStorage` — «там токени помирають від XSS».

### Паролі
Ніколи не зберігаємо. Повільний хеш із сіллю (better-auth — scrypt; на слайдах argon2id/bcrypt).
Наш seed хешує тим самим `hashPassword` з `better-auth/crypto` — тому сідові юзери можуть логінитись.

### CORS у двох реченнях
Браузер сам не віддасть JS відповідь з іншого origin, поки сервер не дозволить. З cookie (`credentials: true`)
`Access-Control-Allow-Origin` мусить бути **точним** origin, не `*` — див. `cors({ origin: [env.WEB_URL], credentials: true })` в `app.ts`.
У dev Vite проксіює `/api|/rpc|/v1|/sse` на API → один origin, CORS майже не видно (`apps/web/vite.config.ts`).

### better-auth у нашому коді
- `packages/auth/src/index.ts` — фабрика `createAuth()`: Drizzle-адаптер на **наші** таблиці, uuid-id, email+пароль,
  опційний GitHub, листи (verify/reset) → **у чергу**, hook після створення юзера (рядок `user_settings` + welcome-лист).
- `apps/api/src/app.ts` — `app.on(["GET","POST"], "/api/auth/*", auth.handler)`; перед цим наш rate limit.
- `middleware/session.ts` — читає сесію в `c.get("session")` для всього нижче.
- `lib/orpc.ts` — `authed` middleware: без сесії → 401, інакше `context.user`.
- клієнт: `apps/web/src/api/auth.ts` (`createAuthClient` з `better-auth/react`).
- OAuth (Authorization Code + PKCE, OIDC) робить бібліотека; від тебе — зареєструвати GitHub OAuth App з callback
  `${API_URL}/api/auth/callback/github` і покласти `GITHUB_CLIENT_ID/SECRET` в `.env`.

### Перевір руками
```bash
curl -s -i -c j.txt -H 'Content-Type: application/json' -X POST localhost:3005/api/auth/sign-up/email \
  -d '{"email":"me@example.com","password":"Password123!","name":"Me"}' | grep -i set-cookie
curl -s -b j.txt localhost:3005/v1/me           # 200 з email/plan/settings
curl -s localhost:3005/v1/me                    # 401 UNAUTHORIZED
```
Лист «Verify your email» лежить у Mailpit: http://localhost:8025.

---

## 6. L11 · Event-driven: черги, worker, outbox, SSE, нотифікації

### Правило
Якщо юзеру не потрібна відповідь **прямо зараз** — знімай роботу з HTTP-шляху. Лист, мініатюра, виклик третьої
сторони — усе це робить **worker**, а API повертає 200 за мілісекунди.

### Три ролі event-driven архітектури
- **Producer** — API: пише подію (`writeOutboxEvent`, `lib/outbox.ts`) або кладе джоб у чергу (`enqueue.*` з `packages/queues`).
- **Broker** — Redis + BullMQ: зберігає джоби, роздає їх, повторює при падінні.
- **Consumer** — `apps/worker`: `email.worker.ts`, `events.worker.ts`, `files.worker.ts`.
Producer не знає про consumer'а. Додаєш п'ятого споживача — API не чіпаєш.

### BullMQ за 30 секунд (`packages/queues/src/index.ts`)
- **Queue** — іменований канал (`email`, `events`, `files`). **Job** — одиниця роботи `{ name, data, opts }`. **Worker** — процес, який тягне джоби з черги з певною `concurrency`.
- Дефолти: `attempts: 5`, `backoff: exponential 1s` (BullMQ додає jitter), тримаємо останні N завершених/впалих для огляду.
- **Ідемпотентність через `jobId`**: той самий id двічі → BullMQ ігнорує дубль. У нас `event-<outboxId>`, `file-<fileId>`, `email-<eventId>-<userId>`. (BullMQ забороняє `:` у jobId — тому дефіси.)
- **UnrecoverableError** — «не повторюй, це назавжди» (невалідний payload, 4xx від провайдера) → одразу у failed set.
- **Dead-letter queue** у нас = failed set BullMQ після останньої спроби; worker логує це на рівні ERROR (`deadLetter: true`) — його видно в логах/Sentry.

### Transactional outbox — щоб подія не загубилась
Проблема: записав у БД, а Redis впав → подія втрачена. Або навпаки: подія пішла, а транзакція відкотилась → подія бреше.
Рішення (`packages/db/src/schema/notifications.ts → outbox`, `apps/api/src/lib/outbox.ts`):
подію пишемо **у ту саму транзакцію**, що й бізнес-запис. Окремий поллер (`apps/worker/src/events/outbox-poller.ts`)
кожні 2 с бере непубліковані рядки (`FOR UPDATE SKIP LOCKED` — кілька worker'ів не заберуть одне й те саме),
кладе у чергу, ставить `published_at`. Гарантія at-least-once + ідемпотентний споживач = «рівно один раз» на практиці.
Через outbox ідуть: `follow.created`, `checkin.created`, `payment.succeeded/failed`. Welcome-лист — best-effort напряму в чергу (втратити не страшно).

### Fan-out нотифікацій (`apps/worker/src/events/events.worker.ts` + `templates.ts`)
Одна подія → отримувачі → канали:
1. рядок у `notifications` (ідемпотентно: `UNIQUE(event_id, user_id)` + `onConflictDoNothing`);
2. `PUBLISH` у Redis-канал `sse:user:<id>` → живий бейдж/тост;
3. лист у чергу `email` — **тільки якщо** `user_settings.email_notifications = true`.
Тексти — в `templates.ts`; тип нотифікації = код (`follow.created`, `streak.milestone`…), фронт рендерить по типу.

### SSE — real-time без WebSocket
- **WebSocket** — двонапрямний, свій протокол, reconnect пишеш сам. **SSE** — сервер → клієнт поверх звичайного HTTP,
  браузерний `EventSource` перепідключається сам і шле `Last-Event-ID`. Для бейджів/прогресу — SSE.
- Сервер: `apps/api/src/modules/sse/sse.controller.ts` (`streamSSE` з Hono): спочатку 401 без сесії, підписка на канал
  **саме цього юзера** через `lib/sse-hub.ts` (одне subscriber-з'єднання Redis на процес, refcount по каналах),
  перша подія — поточний `unread-count`, heartbeat кожні 25 с, відписка на abort.
- Клієнт: `apps/web/src/api/sse.ts` (`useSse`), бейдж у `components/Layout.tsx`.
- Чому через Redis Pub/Sub, а не напряму: worker — окремий процес, API може мати кілька реплік.

### Email
Інтерфейс `EmailSender` (`apps/worker/src/email/sender.ts`) із трьома реалізаціями: `console` (лог), `smtp`
(nodemailer → Mailpit локально, інбокс на :8025), `resend` (прод). Перемикається `EMAIL_PROVIDER` — «SDK за інтерфейсом».

### Перевір руками
```bash
pnpm --filter @habit-tracker/worker start        # окремий термінал
curl -s -N -b j.txt localhost:3005/sse/stream    # тримай відкритим…
# …а в іншому терміналі підпишись на когось / відміть звичку до milestone → у стрімі з'явиться event: notification
open http://localhost:8025                        # листи
```

---

## 7. L12 · Файли, вебхуки, Stripe

### Object storage ≠ файлова система
Bucket → key (плоский рядок, слеші — просто символи) → об'єкт (байти + HTTP-заголовки). MinIO локально = той самий
S3 API (`packages/storage`, `@aws-sdk/client-s3` з `forcePathStyle`). У проді — S3/GCS, міняється лише env.
Бакет **приватний**; читання — через короткоживучий presigned GET або стрім через API.

### Presigned upload — 5 кроків (`modules/files/files.service.ts`)
1. **ASK** — клієнт: «хочу залити avatar.png, 70 байт, image/png» → API перевіряє тип (415), розмір (413), створює рядок `files` зі статусом `pending`.
2. **SIGN** — API підписує PUT-URL: у підписі — метод, бакет, ключ, `Content-Type`, термін 5 хв. Секретний ключ клієнт не бачить; підміна будь-чого ламає підпис.
3. **UPLOAD** — браузер `PUT`-ить байти прямо в MinIO. API не бачить жодного байта → сервер не росте разом із файлами.
4. **ACK** — клієнт каже «готово» → API робить `HEAD` (чи є об'єкт, реальний розмір), статус `uploaded`, ставить джоб `file.process`.
5. **PROCESS** — worker (`apps/worker/src/files/files.worker.ts`): magic bytes (`file-type`) — бо `Content-Type` від клієнта лише побажання;
   `sharp` → розміри + webp-мініатюра 256px; статус `ready`/`rejected`; прогрес по SSE; для аватара — `users.image`.
Завантаження назад: presigned GET у DTO (`toDto`) або **стрім** через `GET /v1/files/:id/content` (`files.download.ts`) — пам'ять стала при будь-якому розмірі.
Загрози, які закриваємо: MIME-spoofing (magic bytes), executable-masquerade (тільки зображення, `Content-Disposition`), розмір (двічі: presign і HEAD).

### Вебхук = третя сторона викликає тебе
`POST /webhooks/stripe` (`modules/webhooks/stripe-webhook.controller.ts`) — без session middleware (підпис замість сесії), **raw body** (пересеріалізований JSON зламає HMAC).
Три перевірки:
1. **HMAC-підпис** (`stripe-signature.ts`): `HMAC-SHA256(secret, "<t>.<rawBody>")` порівняти з `v1=` через `timingSafeEqual` (щоб не витікав час порівняння). Це рукою написаний еквівалент `stripe.webhooks.constructEvent`.
2. **Timestamp** у межах 5 хв — захист від replay.
3. **Idempotency**: `INSERT INTO webhook_events(id)` у транзакції; unique violation = «вже було» → 200 без дії (`stripe-webhook.service.ts`).
Далі — `switch(event.type)`: `payment_intent.succeeded` → `payments.status`, `users.plan = 'pro'`, outbox-подія → нотифікація + чек на email. Усе в одній транзакції.

### Stripe Payment Intent — хто що робить
1. сервер створює Payment Intent (`billing.service.ts`, з `idempotencyKey` і `metadata.paymentId`) → `clientSecret`;
2. браузер підтверджує оплату через Stripe.js/`PaymentElement` (`apps/web/.../SettingsPage.tsx`) — карта не торкається нашого API;
3. **джерело правди — вебхук**, не редирект: доступ дає обробник події, не UI.
Локально: `stripe listen --forward-to localhost:3005/webhooks/stripe`, тестова карта `4242 4242 4242 4242`.

### Перевір руками
```bash
# presign → PUT → ack повний цикл робить apps/web (Settings → Avatar) або див. apps/api/src/test
# вебхук без Stripe: тест apps/api/src/test/webhooks.test.ts підписує payload сам
pnpm --filter @habit-tracker/api test:integration
```

---

## 8. L13 · Docker, Compose, CI/CD

### Контейнер — це процес зі стінами
Namespaces (свій PID/мережа/файлова система), cgroups (ліміти CPU/RAM), overlay-шари (усі контейнери одного образу
ділять базові шари). **Image** — заморожена ФС + метадані (immutable, адресується SHA). **Container** — запущений образ. **Registry** — де образи лежать (GHCR).

### Наші Dockerfile'и (`apps/api/Dockerfile`, `apps/worker/Dockerfile`)
- **multi-stage**: `pruner` (`turbo prune` → тільки потрібна частина монорепо) → `installer` (`pnpm install --prod --frozen-lockfile`, маніфести копіюються **до** коду — шар з deps живе в кеші між комітами) → `runtime` (alpine, `USER node`, `HEALTHCHECK`, `EXPOSE`).
- Пінований `node:22.21.1-alpine`, пінований pnpm через corepack.
- Порядок інструкцій = кеш: зміна `src/` не переставляє `node_modules`.
- TypeScript виконується `tsx` (пакети монорепо споживаються як сирці — свідоме спрощення для курсу; компіляція в JS — окремий крок для L14+).
- `.dockerignore` — без нього в контекст полетять `node_modules` і `.env`.

### Compose (`docker-compose.yml`)
- Інфра: `postgres` (host :5433), `redis` (:6380), `minio` (:9000, консоль :9001) + одноразовий `minio-init` (створює бакет), `mailpit` (:8025).
- `healthcheck` + `depends_on: condition: service_healthy` — api стартує лише коли БД реально готова.
- Профіль `app`: `migrate` (виконує міграції та **завершується**), `api` (`depends_on: migrate: service_completed_successfully`), `worker`.
- Усередині мережі сервіси бачать одне одного за іменами: `postgres:5432`, `redis:6379`, `minio:9000` — тому є `.env.docker`.
```bash
pnpm db:up          # тільки інфра (dev)
pnpm stack:up       # усе в контейнерах: migrate → api → worker
docker compose logs -f api worker
```

### GitHub Actions (`.github/workflows/`)
- `ci.yml`: на push/PR → `check` (lint, typecheck, unit) → `integration` (сервіс-контейнери Postgres+Redis, спочатку міграції, потім інтеграційні тести). Кеш pnpm через `setup-node`.
- `release.yml`: на `main` → buildx + QEMU → мультиарх (amd64+arm64) образи `api`/`worker` у GHCR з тегами `:<sha>` (незмінний — деплой САМЕ його), `:main`, `:latest` (попереджувальний ярлик). Кеш шарів `type=gha`.
- `migrate.yml`: ручний запуск, GitHub Environment `production` з обов'язковим approve → `pnpm --filter @habit-tracker/api migrate` (advisory lock усередині).
Стратегія деплою: rolling (Railway за замовчуванням); rollback = передеплой попереднього `:sha`; міграції завжди backward-compatible і **до** нового коду.

### Definition of Done L14 — де ми
| Пункт | Стан |
|---|---|
| README: setup, env, тести, compose | ✅ |
| `docker compose up` з чистого клону | ✅ (`pnpm stack:up`) |
| CI зелений, < 3 хв | ✅ написано (перевірити після першого push у GitHub) |
| Образи в GHCR amd64+arm64 | ✅ workflow (запуститься після push у `main`) |
| Міграції reversible/на чистій БД без помилок | ✅ (test-utils створює чисту БД у тестах) |
| Auth: sign-up/in/out, reset, verify, revoke | ✅ better-auth (`/api/auth/*`), UI sign-in/up |
| Stripe test-mode e2e | ✅ код + тест; потрібні твої тестові ключі |
| Presigned upload / стрім / worker | ✅ |
| Sentry api+worker, Pino з requestId | ✅ (Sentry вмикається `SENTRY_DSN`) |
| Два seed-скрипти, ідемпотентні | ✅ `db:seed`, `db:reset` |
| Секретів у git немає, `.env.example` з коментарями | ✅ |

---

## 8b. L14 · Production deployment (Railway) — фінал курсу

### PaaS одним абзацом
Railway — це **оренда**: ти віддаєш сервери, мережу і TLS платформі, лишаєш собі застосунок.
`git push` → платформа збирає образ (у нас — **наш Dockerfile**, той самий, що тестував CI, а не
автодетект Railpack) → запускає контейнер, інжектить env-змінні, тримає стільки реплік, скільки
попросив, дає домен із сертифікатом. Що втрачаєш: глибокий контроль (свій kernel, service mesh) —
на цьому етапі продукту це обмін, який ти *хочеш*.

### Чотири об'єкти Railway
| Об'єкт | Що це | У нас |
|---|---|---|
| **Project** | контейнер всього: сервіси, середовища, білінг | habit-tracker |
| **Environment** | ізольована копія всіх сервісів: свої змінні, своя БД | production (з першого дня), + staging, + PR-env |
| **Service** | одна деплойна одиниця | api, worker, Postgres, Redis (+ MinIO/R2) |
| **Deployment** | один build-and-run одного сервісу в одному середовищі | має id, логи, стан: Building → Deploying → Active / Crashed |

Кожна зміна скоупиться до **одного** середовища — це правило рятує від «ой, це був прод».

### Перший деплой — з CLI (щоб бачити кожен крок; далі деплой = git push)
```bash
railway login
railway init                      # проект + середовище production
railway link                      # прив'язати цю теку
railway add --database postgres   # managed БД: volume, бекапи, метрики
railway add --database redis
railway up                        # збілдити й задеплоїти поточну теку
railway domain                    # https://<service>.up.railway.app + сертифікат
railway logs / railway status
```

### Приватна мережа і змінні — де ховаються гроші та інциденти
- Сервіси говорять між собою по `*.railway.internal` (шифрована приватна мережа): **публічний URL —
  для браузерів, приватний DNS — для всього іншого.** Навпаки = класичний «сюрприз у рахунку» (egress).
- Змінні — **посиланням, не копіпастом**: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`,
  `REDIS_URL = ${{Redis.REDIS_URL}}`. Ротація пароля тоді не ламає сервіс мовчки.
- **PORT-контракт**: Railway інжектить `PORT`; бінд на всі інтерфейси, не localhost. Нюанс поза
  слайдом: приватна мережа Railway — IPv6-only, тому у нас `hostname: "::"` (dual-stack IPv4+IPv6;
  `0.0.0.0` відмовив би внутрішньому трафіку) — `apps/api/src/index.ts`.
- Вбудовані змінні на кожен деплой: `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_PRIVATE_DOMAIN`,
  `RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_DEPLOYMENT_ID`. У нас `loadEnv()` підхоплює
  `RAILWAY_GIT_COMMIT_SHA` як `GIT_SHA` → `/health.version` і Sentry `release` = задеплоєний коміт.
- Redis — **не база даних**: кеш, черги, лічильники. Все в ньому має бути втрачабельним.

### Чесний /health гейтить деплой
Health check, який завжди відповідає 200 — «брехня зі статус-кодом». Наш `/health`
(`modules/health/health.controller.ts`) реально питає Postgres і Redis і віддає **503**, коли щось
лежить, плюс `version`. Railway полить `healthcheckPath`, поки не отримає 200, і **тільки тоді**
пускає трафік на новий деплоймент; нема 200 за `healthcheckTimeout` — деплой failed, **стара версія
служить далі**. Старий і новий контейнер перекриваються; старому прилітає SIGTERM + grace-період —
наш graceful shutdown (перестати приймати, дочекатись поточних, закрити пули) саме для цього.
Readiness («чи можу служити?») — робота платформи при старті; liveness («чи не завис я?») — робота
моніторингу/restart policy, це різні речі.

### Міграції: preDeployCommand
`apps/api/railway.json` → `"preDeployCommand": ["pnpm --filter @habit-tracker/api migrate"]` —
міграції біжать **до** того, як новий образ отримає трафік. Впала міграція → релізу нема, стара
версія працює. Правила з L13 тепер enforce'ить платформа: additive-first, одна логічна зміна на
файл, advisory lock всередині мігратора (два деплої не гоняться). У staging той самий файл додає
`db:seed` — свіжі демо-дані на кожен деплой.

### Середовища: prod / staging / PR
Одна й та сама **картинка** (image), різні **змінні й дані** — environment parity.
| | production | staging | PR-env |
|---|---|---|---|
| дані | реальні + бекапи | анонімізовані/seed, ніколи прод-дамп | свіжий seed, викидається |
| секрети | live-ключі (Stripe live) | test-ключі | test, успадковані зі staging |
| деплой | merge у main | кожен merge у staging-гілку | кожен push у PR |
Staging **не має фізичної змоги** дістати прод-БД — якщо один вкрадений токен дістає реальні гроші,
розділення декоративне. Секрети: ніколи в git (`.env` ignored, `.env.example` з фейками), посилання
замість вставки, валідація Zod на старті (контейнер відмовляється стартувати без ключа — а не падає
на першому checkout у п'ятницю ввечері), ротація при зміні складу команди.

### Домен, HTTPS, edge
`railway domain` дає `*.up.railway.app` із сертифікатом (для staging/демо). Свій домен: додати
`api.your.app` у Settings → створити CNAME → сертифікат видається й оновлюється сам. Платформа
терминує TLS; **CORS allow-list, cookies, security headers, rate limits — досі твій код.**

### Rollback за 30 секунд
- **Roll back, don't hotfix**: о 2-й ночі передеплой останнього робочого деплойменту (dashboard/CLI),
  дебаг — потім, коли трафік уже обслуговується правильно.
- Rollback має **термін придатності** (retention плану) — найшвидший запасний шлях: передеплой
  попереднього `:sha` образу з GHCR (наш release.yml саме тому тегає кожен коміт).
- **Схема не відкочується**: код повертається за секунди, дропнута колонка — ні. Саме тому міграції
  additive і «дві релізи нарізно».
- **Репетируй**: відкат staging у звичайний вівторок із секундоміром. Невідрепетируваний rollback —
  це план, а не здатність.

### Observability: чотири інструменти
| Інструмент | Питання | У нас |
|---|---|---|
| **Logs** | що сталося? | JSON-рядки Pino зі `requestId` → Log Explorer: `@level:error AND @route:"POST /orders"` |
| **Metrics** | скільки? (CPU/RAM/мережа) | вкладка Observability — тут видно memory leak до OOM-kill |
| **Traces** | де час? | OpenTelemetry api → db → worker (наступний крок після курсу) |
| **Alerts** | кого будити? | uptime-чек + поріг error-rate → конкретна людина, не спільна скринька |
Sentry: `environment` = RAILWAY_ENVIRONMENT_NAME, `release` = commit sha → кожна помилка
атрибутується деплою, який її приніс; «нове з минулого релізу» — питання, на яке Sentry відповідає сам.
Ніколи не логуй токени/паролі/карти (Pino `redact` уже налаштований).

### Бекапи і restore drill
Volumes бекапляться за розкладом (daily×6, weekly×4, monthly×3; інкрементально). Restore — реальна
операція: ставить зміну і передеплоює, видаляє бекапи новіші за точку відновлення. **Невідновлений
бекап — не бекап**: раз на квартал відновлюй у staging із секундоміром і запиши фактичні
**RPO** (скільки даних втратили) і **RTO** (скільки часу відновлювались) числами.

### Скейлінг — у цьому порядку
1. знайди повільний запит, додай **індекс** (безкоштовно) → 2. **кешуй** те, що рідко міняється
(дешево) → 3. винеси роботу у **worker** (зробили в L11) → 4. **vertical**: більше CPU/RAM →
5. **horizontal**: репліки (сервіс має бути stateless — volume виключає репліки) → 6. **geographic**:
репліки біля користувачів. «90% "нам треба скейлитись" — це один відсутній індекс.»

### Ціна
Платиш за compute (vCPU+RAM за хвилину, за репліку), volumes (GB), **egress** (GB назовні — тому
внутрішній трафік по `railway.internal`), бекапи, підписку ($5 Hobby / $20 Pro). Найдорожчий рядок,
якого нема в рахунку — **години інженера**; це те, що managed-платформа реально економить.

### AWS-мапа (для співбесід)
| AWS | Що це | Наш еквівалент |
|---|---|---|
| EC2 | VM, яку ти адмініструєш | шар, який Railway ховає |
| ECS + Fargate | запуск контейнерів без серверів | Railway service |
| RDS | managed реляційна БД | `railway add --database postgres` |
| S3 | object storage за ключем | MinIO з L12 (той самий API) |
| ElastiCache | managed Redis | Redis service |
| Lambda | функція на подію, нуль у простої | нема еквівалента (інша модель) |
| CloudWatch | логи+метрики+алерти | вкладка Observability |
| IAM + Secrets Mgr | хто що може; де секрети | project members + service variables |
**IAM одним реченням**: policy = «який principal може яку action на якому resource», повторено
тисячі разів. **Least privilege**: найвужча дія найвужчому ресурсу, роль замість юзера, CI бере
короткоживучу роль (OIDC), а не вічний ключ. **VM vs container vs function**: контейнер — дефолт
(портативний); serverless виграє на спайковому короткому stateless; VM — коли реально треба машина.

### Інцидент: перші 30 хвилин
1. **Зупини кровотечу** — спочатку rollback, потім розуміння. 2. **Один власник** — призначений
incident lead, решта репортять йому. 3. **Скажи щось** — навіть «знаємо, розбираємось» купує
терпіння; мовчання перетворює аварію на відтік. 4. **Blameless post-mortem** — timeline, impact,
причина, 2–3 дії з власниками й датами; результат — змінена система, а не покараний інженер.

### Фінальне ДЗ (deliverables — «здаєш URL, а не репозиторій»)
- **A. Live URL** — app + API по HTTPS на налаштованому домені, seed-дані, демо-акаунт для входу.
- **B. Deploy you can defend** — health check гейтить, preDeployCommand-міграції, розділені
  середовища, секрети через посилання, бекапи ввімкнені.
- **C. Rollback recording** — навмисно зламаний деплой у staging → відкат; запис екрану ~2 хв.

### Deploy gate (що значить «shipped») — чеклист здачі
☐ https:// відкриває застосунок; `/health` = 200 з `version` = задеплоєний коміт ☐ api і worker на
Railway, worker видимо розгрібає чергу в логах ☐ Postgres/Redis через `*.railway.internal`, ніякого
публічного DB URL ☐ міграції як preDeployCommand; навмисно зламана міграція блокує реліз ☐ staging
реальний: свої дані, не дістає прод ☐ свій домен + сертифікат; CORS на конкретний origin, не `*`
☐ секрети — reference-змінні; git чистий; `.env.example` повний ☐ Sentry ловить помилки api+worker з
environment+release ☐ JSON-логи з request id; приклад Log Explorer-запиту в README ☐ бекапи за
розкладом; один restore у staging із заміряним часом ☐ rollback відрепетируваний і записаний;
попередній образ досі деплойний ☐ README веде від clone до deploy без недокументованих кроків

---

## 9. Словник (коротко, своїми словами)

| Термін | Що це |
|---|---|
| **N-layer / модульний моноліт** | один сервіс, поділений на модулі (`habits`, `files`…), у кожному controller → service → repository |
| **DTO** | форма даних, яку API обіцяє клієнту; не рядок БД |
| **Entity** | рядок таблиці як TS-тип (`typeof habits.$inferSelect`) |
| **Idempotency** | повторити операцію безпечно (той самий результат): unique-ключі, `jobId`, `webhook_events` |
| **Транзакція / ACID** | група запитів «все або нічого»; `db.transaction` |
| **`FOR UPDATE`** | блокування рядка до кінця транзакції — серіалізує паралельні зміни |
| **Денормалізація** | зберігати похідне значення (`current_streak`) заради швидкого читання; оновлювати в тій самій транзакції |
| **Offset / cursor пагінація** | «пропусти N» vs «продовжуй після ключа» |
| **Keyset** | інша назва cursor-пагінації по (`created_at`, `id`) |
| **Cache-aside** | додаток сам читає кеш, при промаху йде в БД і кладе в кеш |
| **TTL** | час життя ключа в Redis |
| **Інвалідація за версією** | у ключі є номер версії; `INCR` версії = усе старе протухло |
| **Correlation / request id** | один id на весь запит у логах і відповіді |
| **Structured logging** | лог = JSON-об'єкт, а не рядок; можна шукати за полями |
| **Retry / backoff / jitter** | повтор із зростаючою + випадковою затримкою |
| **Rate limit / sliding window** | обмеження запитів за ковзне вікно (sorted set у Redis) |
| **Session vs JWT** | рядок у БД + cookie-посилання vs самодостатній підписаний токен |
| **HttpOnly / SameSite / Secure** | прапорці cookie: не читати з JS / не слати між сайтами / тільки HTTPS |
| **CORS / preflight** | дозвіл браузеру читати відповідь з іншого origin; `OPTIONS` перед «непростими» запитами |
| **OAuth 2.0 / OIDC / PKCE** | делегований доступ / «і хто це» поверх OAuth / захист коду авторизації |
| **Producer / broker / consumer** | хто публікує / хто зберігає й роздає / хто обробляє |
| **Queue / job / worker** | канал / одиниця роботи / процес-обробник |
| **DLQ (dead-letter)** | куди падають джоби після всіх спроб |
| **Outbox** | таблиця подій, записана в одній транзакції з даними |
| **Fan-out** | одна подія → багато отримувачів/каналів |
| **Pub/Sub** | Redis `PUBLISH`/`SUBSCRIBE` — миттєве повідомлення без черги |
| **SSE** | сервер → браузер потік подій поверх HTTP; `EventSource` |
| **Presigned URL** | URL із підписом = тимчасовий дозвіл на PUT/GET конкретного ключа |
| **Magic bytes** | перші байти файлу, які видають справжній формат |
| **HMAC** | підпис повідомлення спільним секретом; перевіряти `timingSafeEqual` |
| **Replay attack** | повторне відправлення перехопленого запиту; захист — timestamp + nonce/event id |
| **Payment Intent** | об'єкт Stripe «одна оплата»; підтверджує браузер, фіналізує вебхук |
| **Multi-stage build** | кілька `FROM` у Dockerfile; у фінальний образ потрапляє мінімум |
| **turbo prune** | вирізати з монорепо тільки те, що потрібно одному застосунку |
| **Healthcheck** | команда, за якою оркестратор вирішує «готовий/перезапустити» |
| **Advisory lock** | ручне блокування в Postgres (`pg_advisory_lock`) — «один мігратор за раз» |
| **Rolling / blue-green / canary** | стратегії викочування; rollback = попередній `:sha` |
| **Graceful shutdown** | на SIGTERM: не приймати нове, дочекатись поточних, закрити пули (`apps/*/src/index.ts`) |
| **PaaS** | платформа-оренда: пуш коду → платформа білдить/запускає/мережить (Railway, Heroku) |
| **PORT-контракт** | платформа інжектить PORT; сервіс біндить його на всі інтерфейси (`::`) |
| **preDeployCommand** | команда (міграції) до перемикання трафіку на новий деплоймент |
| **Environment parity** | prod/staging/PR — той самий образ, різні лише змінні й дані |
| **Egress** | трафік, що покидає платформу; внутрішні виклики — по приватному DNS |
| **RPO / RTO** | скільки даних втратили / скільки часу відновлювались — виміряні числа |
| **Readiness vs liveness** | «можу служити?» (гейт деплою) vs «не завис?» (restart policy) |
| **Incident lead** | одна людина, що веде інцидент; решта репортять їй |
| **Blameless post-mortem** | розбір: timeline, причина, дії з власниками — без пошуку винних |

---

## 10. Команди-шпаргалка

```bash
# інфра
pnpm db:up / pnpm db:down                     # postgres+redis+minio+mailpit
pnpm db:generate  → pnpm db:migrate           # схема → SQL → застосувати
pnpm db:seed / pnpm db:reset / pnpm db:studio
# розробка
pnpm dev                                      # api + worker + web (turbo)
pnpm --filter @habit-tracker/api start        # тільки api (:3005)
pnpm --filter @habit-tracker/worker start
pnpm --filter @habit-tracker/web dev          # :5173 (проксі на api)
# якість
pnpm lint / pnpm lint:fix / pnpm typecheck
pnpm test                                     # unit (shared, types, api, worker)
pnpm test:integration                         # api проти реальних Postgres/Redis (БД habit_tracker_test)
# контейнери
pnpm stack:up / pnpm stack:down               # migrate → api → worker у docker
docker build -f apps/api/Dockerfile -t habit-tracker-api .
# корисні URL
http://localhost:3005/v1/docs   http://localhost:3005/health   http://localhost:8025 (пошта)
http://localhost:9001 (MinIO console, minioadmin/minioadmin)   http://localhost:5173 (web)
```

---

## 11. Що спитають на захисті (L14) — і як відповісти одним реченням

- **Чому check-in атомарний?** — Вставка, перерахунок streak і подія в outbox — одна транзакція з `FOR UPDATE`; дубль за день ловить `UNIQUE`, а не код (`check-ins.service.ts`).
- **Чому cursor, а не offset для стрічки?** — Стрічка росте й змінюється; keyset — стала швидкість і стабільність під вставками; offset лишили каталогам зі сторінками.
- **Як гарантуєш, що подія не загубиться?** — Transactional outbox + poller + ідемпотентний споживач (`UNIQUE(event_id, user_id)`, `jobId`).
- **Чому 404, а не 403 для приватної звички?** — Не підтверджуємо існування чужого ресурсу (privacy-safe); 403 — лише коли власник відомий і дія заборонена.
- **Як інвалідуєш кеш?** — TTL як страховка + версія в ключі, яку бампаємо на запис; жодних wildcard-delete.
- **Чому сесії, а не JWT?** — Треба відкликати (logout everywhere), одна служба, немає потреби у stateless; better-auth дає це з коробки.
- **Що станеться, якщо Stripe надішле вебхук двічі?** — Другий `INSERT` у `webhook_events` впаде по unique → відповідаємо 200 і нічого не робимо.
- **Чому API не бачить байти файлу?** — Presigned PUT: браузер пише в MinIO напряму; сервер лише підписує URL і перевіряє метадані/HEAD; worker перевіряє magic bytes.
- **Що ламається без jitter?** — Синхронні «стампеди» ретраїв після збою.
- **Як деплоїш міграції?** — Окремою джобою до нового образу, backward-compatible, під `pg_advisory_lock`; rollback = попередній `:sha`.

---

## 12. Що потребує *твоїх* дій (я не міг зробити за тебе)

1. **Подивитись відео уроків** — я бачив лише слайди/ресурси, не записи.
2. **GitHub OAuth App** → `GITHUB_CLIENT_ID/SECRET` в `.env` (callback `http://localhost:3005/api/auth/callback/github`).
3. **Stripe test keys** → `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (із `stripe listen`), у web — `VITE_STRIPE_PUBLISHABLE_KEY`.
4. **Опційно**: `RESEND_API_KEY` (замість Mailpit), `SENTRY_DSN`.
5. **GitHub**: запушити, перевірити CI; створити Environment `production` (секрет `DATABASE_URL`, required reviewers) для `migrate.yml`; після мержу в `main` з'являться образи в GHCR.
6. **L14 — деплой на Railway** (код готовий: `railway.json` для api/worker, /health гейт, preDeploy-міграції, SPA сервиться з api; покрокова інструкція — у README → “Deploy to Railway”). Від тебе: акаунт Railway, `railway login`, змінні, домен, бекапи, запис rollback-у.
7. **Коміти**: я нічого не комітив — переглянь `git status`/`git diff`, і скажи, коли комітити (можна по уроках: L8, L9, … як окремі коміти, або одним).
