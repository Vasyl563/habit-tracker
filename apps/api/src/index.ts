import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createContainer } from "./container.js";

/**
 * Boot sequence:
 *   env (fail fast) → Sentry → container (db/redis/queues/storage/auth/services)
 *   → Hono app → HTTP server → graceful shutdown on SIGTERM/SIGINT.
 */
const env = loadEnv();

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    // production | staging | pr-142 on Railway; falls back to NODE_ENV locally
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV,
    release: env.GIT_SHA,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // scrub PII before it leaves the box
      if (event.request?.headers) {
        delete event.request.headers.cookie;
        delete event.request.headers.authorization;
      }
      return event;
    }
  });
}

const container = createContainer(env);
const { logger } = container;

// object storage: make sure the bucket exists (idempotent)
await container.storage.ensureBucket().catch((err) => {
  logger.warn({ err }, "could not ensure S3 bucket — uploads will fail until storage is up");
});

const app = createApp(container);

// The PORT contract (L14): bind the injected PORT on all interfaces — never
// localhost. "::" is dual-stack (IPv4 + IPv6); Railway's private network is
// IPv6-only, so a plain 0.0.0.0 bind would refuse internal traffic.
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "::" }, (info) => {
  logger.info(
    { port: info.port, docs: `${env.API_URL}/v1/docs`, env: env.NODE_ENV },
    "habit-tracker api listening"
  );
});

/**
 * Graceful shutdown (L9 self-study, L13): stop accepting connections, let
 * in-flight requests finish, close pools. The difference between a clean
 * deploy and a burst of 502s.
 */
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down…");
  const forceExit = setTimeout(() => {
    logger.error("shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000).unref();

  server.close(async (err) => {
    if (err) logger.error({ err }, "error closing http server");
    await container.close().catch((e) => logger.error({ err: e }, "error closing container"));
    clearTimeout(forceExit);
    logger.info("bye");
    process.exit(0);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
