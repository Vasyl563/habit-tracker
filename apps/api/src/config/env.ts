import { fileURLToPath } from "node:url";
import { parseEnv } from "@habit-tracker/shared";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Load the repo-root .env once (this file lives in apps/api/src/config/).
loadDotenv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/**
 * Every variable the API needs, validated once at boot (L8). Anything missing
 * or malformed stops the process with a readable list — never a runtime
 * surprise three requests in.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3005),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  API_URL: z.url().default("http://localhost:3005"),
  WEB_URL: z.url().default("http://localhost:5173"),

  BETTER_AUTH_SECRET: z.string().min(16, "use a long random secret (openssl rand -base64 32)"),
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,

  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  PRO_PLAN_AMOUNT: z.coerce.number().int().positive().default(500),
  PRO_PLAN_CURRENCY: z.string().length(3).default("usd"),

  SENTRY_DSN: optionalString,
  GIT_SHA: optionalString,
  /** where the built SPA lives (set in the Docker image); api serves it when present */
  WEB_DIST_DIR: optionalString
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Railway stamps every deployment with these — adopt them when ours are absent,
  // so /health `version` and Sentry `release` always match the deployed commit (L14).
  if (!source.GIT_SHA) source.GIT_SHA = source.RAILWAY_GIT_COMMIT_SHA; // '' counts as unset
  return parseEnv(envSchema, source);
}
