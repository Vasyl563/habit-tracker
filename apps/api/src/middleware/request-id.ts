import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app-env.js";

/**
 * Correlation ID (L9): read `x-request-id` if a proxy/client set one,
 * otherwise mint a UUID; echo it back so the client can quote it in a bug
 * report. Every log line of this request carries the same id.
 */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = c.req.header("x-request-id")?.slice(0, 128) ?? randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
});
