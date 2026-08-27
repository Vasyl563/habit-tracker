import { createDb } from "@habit-tracker/db";
import { truncateAll } from "@habit-tracker/db/test-utils";
import { createLogger } from "@habit-tracker/logger";
import type { Hono } from "hono";
import { createApp } from "../app.js";
import type { AppEnv } from "../app-env.js";
import { type Container, createContainer } from "../container.js";
import { testEnv } from "./test-env.js";

export interface TestApp {
  app: Hono<AppEnv>;
  container: Container;
  /** wipe every table — call in beforeEach/beforeAll for isolation */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Full app wired to the test DB + Redis db 9. Nothing listens on a port. */
export async function createTestApp(): Promise<TestApp> {
  const env = testEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  const logger = createLogger({ name: "api-test", level: env.LOG_LEVEL });
  const container = createContainer(env, { db, logger });
  const app = createApp(container);
  await container.redis.flushdb(); // rate-limit counters, cache, queues from previous runs
  return {
    app,
    container,
    reset: () => truncateAll(db),
    async close() {
      await container.close();
      await pool.end();
    }
  };
}

export interface Session {
  cookie: string;
  userId: string;
  email: string;
}

/** Sign up through better-auth's real HTTP endpoint and keep the cookie. */
export async function signUp(app: Hono<AppEnv>, name: string, email?: string): Promise<Session> {
  const mail =
    email ??
    `${name.toLowerCase().replace(/\s+/g, ".")}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify({ email: mail, password: "Password123!", name })
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  const body = (await res.json()) as { user: { id: string } };
  return { cookie, userId: body.user.id, email: mail };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/** JSON helper over app.request(); pass a Session to act as that user. */
export async function api<T = unknown>(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  options: { session?: Session; body?: unknown; headers?: Record<string, string> } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.session) headers.cookie = options.session.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body (e.g. streams) */
  }
  return { status: res.status, body: body as T, headers: res.headers };
}
