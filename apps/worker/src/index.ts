import { createDb } from "@habit-tracker/db";
import { createLogger } from "@habit-tracker/logger";
import { closeQueues, createQueues } from "@habit-tracker/queues";
import { createRedis } from "@habit-tracker/redis";
import { createStorage } from "@habit-tracker/storage";
import * as Sentry from "@sentry/node";
import { loadEnv } from "./config/env.js";
import { startEmailWorker } from "./email/email.worker.js";
import { createEmailSender } from "./email/sender.js";
import { startEventsWorker } from "./events/events.worker.js";
import { startOutboxPoller } from "./events/outbox-poller.js";
import { startFilesWorker } from "./files/files.worker.js";

/**
 * The worker process (L11): no HTTP, no users waiting. It pulls jobs from
 * Redis (BullMQ), talks to Postgres/MinIO/SMTP, and pushes real-time updates
 * back through Redis Pub/Sub. Scale by running more of these.
 */
const env = loadEnv();
const logger = createLogger({
  name: "worker",
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === "development"
});

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV,
    release: env.GIT_SHA
  });
}

const { db, pool } = createDb(env.DATABASE_URL);
const redisWorkers = createRedis(env.REDIS_URL, "bullmq"); // consumers
const redisQueues = createRedis(env.REDIS_URL, "bullmq"); // producers (email/event jobs we emit)
const redisPublisher = createRedis(env.REDIS_URL, "general"); // PUBLISH for SSE
const queues = createQueues(redisQueues);
const storage = createStorage({
  endpoint: env.S3_ENDPOINT,
  publicEndpoint: env.S3_PUBLIC_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKey: env.S3_ACCESS_KEY,
  secretKey: env.S3_SECRET_KEY
});

const emailSender = createEmailSender(env, logger);
const workers = [
  startEmailWorker(redisWorkers, emailSender, logger),
  startEventsWorker(redisWorkers, db, queues, redisPublisher, logger, env.WEB_URL),
  startFilesWorker(redisWorkers, db, storage, queues, redisPublisher, logger, {
    maxBytes: env.UPLOAD_MAX_BYTES,
    apiUrl: env.API_URL
  })
];
const poller = startOutboxPoller(db, queues, logger, env.OUTBOX_POLL_MS);

logger.info(
  {
    queues: workers.map((w) => w.name),
    emailProvider: emailSender.name,
    outboxPollMs: env.OUTBOX_POLL_MS
  },
  "habit-tracker worker started"
);

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    if (env.SENTRY_DSN)
      Sentry.captureException(err, { tags: { queue: worker.name, jobId: job?.id } });
  });
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker shutting down…");
  const force = setTimeout(() => process.exit(1), 15_000).unref();
  try {
    await poller.stop();
    // close() waits for in-flight jobs to finish — no half-sent emails
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues(queues);
    await Promise.allSettled([redisWorkers.quit(), redisQueues.quit(), redisPublisher.quit()]);
    await storage.destroy();
    await pool.end();
  } finally {
    clearTimeout(force);
    logger.info("worker stopped");
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) =>
  logger.error({ err: reason }, "unhandled promise rejection")
);
