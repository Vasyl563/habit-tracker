import { type Auth, createAuth } from "@habit-tracker/auth";
import { createDb, type Db } from "@habit-tracker/db";
import { createLogger, type Logger } from "@habit-tracker/logger";
import { closeQueues, createQueues, enqueue, type Queues } from "@habit-tracker/queues";
import { createRedis, type Redis } from "@habit-tracker/redis";
import { createStorage, type Storage } from "@habit-tracker/storage";
import Stripe from "stripe";
import type { Env } from "./config/env.js";
import { type Cache, createCache } from "./lib/cache.js";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
import { createSseHub, type SseHub } from "./lib/sse-hub.js";
import { BillingRepository } from "./modules/billing/billing.repository.js";
import { BillingService } from "./modules/billing/billing.service.js";
import { CheckInsRepository } from "./modules/check-ins/check-ins.repository.js";
import { CheckInsService } from "./modules/check-ins/check-ins.service.js";
import { FeedRepository } from "./modules/feed/feed.repository.js";
import { FeedService } from "./modules/feed/feed.service.js";
import { FilesRepository } from "./modules/files/files.repository.js";
import { FilesService } from "./modules/files/files.service.js";
import { FollowsRepository } from "./modules/follows/follows.repository.js";
import { FollowsService } from "./modules/follows/follows.service.js";
import { HabitsRepository } from "./modules/habits/habits.repository.js";
import { HabitsService } from "./modules/habits/habits.service.js";
import { NotificationsRepository } from "./modules/notifications/notifications.repository.js";
import { NotificationsService } from "./modules/notifications/notifications.service.js";
import { UsersRepository } from "./modules/users/users.repository.js";
import { UsersService } from "./modules/users/users.service.js";
import { StripeWebhookService } from "./modules/webhooks/stripe-webhook.service.js";

/** Every service the controllers can reach through `context.services`. */
export interface Services {
  users: UsersService;
  habits: HabitsService;
  checkIns: CheckInsService;
  follows: FollowsService;
  feed: FeedService;
  notifications: NotificationsService;
  files: FilesService;
  billing: BillingService;
  stripeWebhook: StripeWebhookService;
}

export interface Container {
  env: Env;
  logger: Logger;
  db: Db;
  redis: Redis;
  cache: Cache;
  rateLimiter: RateLimiter;
  queues: Queues;
  storage: Storage;
  auth: Auth;
  sseHub: SseHub;
  services: Services;
  /** graceful shutdown: drain and close every connection */
  close(): Promise<void>;
}

/**
 * Composition root (L4/L5). Everything is constructed ONCE here, top-down:
 * infrastructure clients → repositories → services. Nothing else in the app
 * uses `new` on a service — controllers receive them through the context.
 * Making dependencies explicit is what lets tests swap a piece (e.g. a fake
 * queue) without monkey-patching.
 */
export function createContainer(env: Env, overrides: { db?: Db; logger?: Logger } = {}): Container {
  const logger =
    overrides.logger ??
    createLogger({
      name: "api",
      level: env.LOG_LEVEL,
      pretty: env.NODE_ENV === "development"
    });

  const created = overrides.db ? null : createDb(env.DATABASE_URL);
  const db = overrides.db ?? (created as NonNullable<typeof created>).db;

  // three redis connections, three jobs (see @habit-tracker/redis)
  const redis = createRedis(env.REDIS_URL, "general");
  const redisQueue = createRedis(env.REDIS_URL, "bullmq");
  const redisSub = createRedis(env.REDIS_URL, "subscriber");

  const cache = createCache(redis, logger);
  const rateLimiter = createRateLimiter(redis);
  const queues = createQueues(redisQueue);
  const sseHub = createSseHub(redisSub, redis, logger);

  const storage = createStorage({
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY
  });

  const stripe = env.STRIPE_SECRET_KEY
    ? new Stripe(env.STRIPE_SECRET_KEY, { typescript: true })
    : null;

  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.API_URL,
    trustedOrigins: [env.WEB_URL, env.API_URL],
    isProduction: env.NODE_ENV === "production",
    github:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
        : undefined,
    onHookError: (error, hook) => logger.error({ err: error, hook }, "auth hook failed"),
    // auth emails go on the queue — the worker sends them (L11)
    sendEmail: async (email) => {
      await enqueue.email(queues, { ...email, template: email.template });
    },
    // welcome email: best-effort, straight enqueue (losing it isn't a bug)
    onUserCreated: async (user) => {
      logger.info({ userId: user.id }, "user created");
      await enqueue.email(
        queues,
        {
          to: user.email,
          subject: "Welcome to Habit Tracker 🎯",
          text: `Hi ${user.name},\n\nWelcome aboard! Create your first habit and check it in today — streaks start with day one.\n\n${env.WEB_URL}`,
          template: "welcome"
        },
        `welcome-${user.id}`
      );
    }
  });

  // ── repositories ──────────────────────────────────────────────────────────
  const usersRepo = new UsersRepository(db);
  const followsRepo = new FollowsRepository(db);
  const habitsRepo = new HabitsRepository(db);
  const checkInsRepo = new CheckInsRepository(db);
  const feedRepo = new FeedRepository(db);
  const notificationsRepo = new NotificationsRepository(db);
  const filesRepo = new FilesRepository(db);
  const billingRepo = new BillingRepository(db);

  // ── services (order matters only for the constructor arguments) ──────────
  const users = new UsersService(usersRepo, cache);
  const habits = new HabitsService(habitsRepo, followsRepo, users, cache);
  const checkIns = new CheckInsService(db, checkInsRepo, habitsRepo, habits, filesRepo);
  const follows = new FollowsService(db, followsRepo, usersRepo, users);
  const feed = new FeedService(feedRepo);
  const notifications = new NotificationsService(notificationsRepo, sseHub);
  const files = new FilesService(filesRepo, storage, queues, env.UPLOAD_MAX_BYTES);
  const billing = new BillingService(billingRepo, usersRepo, stripe, {
    amount: env.PRO_PLAN_AMOUNT,
    currency: env.PRO_PLAN_CURRENCY
  });
  const stripeWebhook = new StripeWebhookService(db, billingRepo, logger);

  return {
    env,
    logger,
    db,
    redis,
    cache,
    rateLimiter,
    queues,
    storage,
    auth,
    sseHub,
    services: {
      users,
      habits,
      checkIns,
      follows,
      feed,
      notifications,
      files,
      billing,
      stripeWebhook
    },
    async close() {
      await sseHub.close();
      await closeQueues(queues);
      await Promise.allSettled([redis.quit(), redisQueue.quit()]);
      await storage.destroy();
      if (created) await created.pool.end();
    }
  };
}
