import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { type Env, envSchema } from "../config/env.js";

/**
 * Environment for integration tests: same variables as dev, but pointing at
 * the *test* database and a separate Redis DB index so a running dev worker
 * never sees test jobs.
 */
export function testEnvSource(): NodeJS.ProcessEnv & { TEST_DATABASE_URL: string } {
  loadDotenv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
  const TEST_DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5433/habit_tracker_test";
  const redis = new URL(process.env.REDIS_URL ?? "redis://localhost:6380");
  redis.pathname = "/9";
  return {
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
    TEST_DATABASE_URL,
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: redis.toString(),
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    STRIPE_SECRET_KEY: "",
    SENTRY_DSN: "",
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:9000",
    S3_BUCKET: "habit-tracker-test",
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "minioadmin",
    S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "minioadmin"
  };
}

export function testEnv(): Env {
  const parsed = envSchema.safeParse(testEnvSource());
  if (!parsed.success) throw new Error(`invalid test env: ${parsed.error.message}`);
  return parsed.data;
}
