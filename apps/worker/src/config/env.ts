import { fileURLToPath } from "node:url";
import { parseEnv } from "@habit-tracker/shared";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/** The worker's own env contract — a subset of the API's, validated the same way. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),

    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    API_URL: z.url().default("http://localhost:3005"),
    WEB_URL: z.url().default("http://localhost:5173"),

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

    EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
    EMAIL_FROM: z.string().min(3).default("Habit Tracker <no-reply@habit-tracker.local>"),
    SMTP_URL: optionalString,
    RESEND_API_KEY: optionalString,

    /** how often the outbox poller looks for unpublished events */
    OUTBOX_POLL_MS: z.coerce.number().int().min(200).default(2_000),

    SENTRY_DSN: optionalString,
    GIT_SHA: optionalString
  })
  .refine((e) => e.EMAIL_PROVIDER !== "smtp" || Boolean(e.SMTP_URL), {
    message: "SMTP_URL is required when EMAIL_PROVIDER=smtp",
    path: ["SMTP_URL"]
  })
  .refine((e) => e.EMAIL_PROVIDER !== "resend" || Boolean(e.RESEND_API_KEY), {
    message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
    path: ["RESEND_API_KEY"]
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  source.GIT_SHA ??= source.RAILWAY_GIT_COMMIT_SHA;
  return parseEnv(envSchema, source);
}
