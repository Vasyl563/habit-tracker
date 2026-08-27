import type { Logger } from "@habit-tracker/logger";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app-env.js";

/**
 * One log line per request (L8/L9): method, path, status, duration, requestId.
 * Also installs a child logger scoped to the request so services can log
 * with `c.get("logger")` and get the requestId for free.
 */
export function requestLogger(root: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const started = performance.now();
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";
    c.set("ip", ip);

    const log = root.child({ requestId: c.get("requestId") });
    c.set("logger", log);

    await next();

    const durationMs = Math.round((performance.now() - started) * 10) / 10;
    const status = c.res.status;
    const line = { method: c.req.method, path: c.req.path, status, durationMs, ip };
    if (status >= 500) log.error(line, "request failed");
    else if (status >= 400) log.warn(line, "request rejected");
    else log.info(line, "request");
  });
}
