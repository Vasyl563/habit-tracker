import type { Logger } from "@habit-tracker/logger";
import * as Sentry from "@sentry/node";
import type { Context } from "hono";
import type { AppEnv } from "../app-env.js";
import { HttpException, RateLimitError } from "../lib/errors.js";

/**
 * Global error handler for plain Hono routes (L9). oRPC procedures have their
 * own boundary (lib/orpc.ts) but end up with the same envelope.
 *
 *   HttpException → its status + { code, message, details }
 *   anything else → 500 { code: INTERNAL_ERROR }, logged with the stack,
 *                    sent to Sentry. Never leaks stack/SQL/paths.
 */
export function errorHandler(rootLogger: Logger, sentryEnabled: boolean) {
  return (error: Error, c: Context<AppEnv>) => {
    const logger = c.get("logger") ?? rootLogger;
    const requestId = c.get("requestId");

    if (error instanceof HttpException) {
      if (error instanceof RateLimitError) c.header("Retry-After", String(error.retryAfterSeconds));
      if (error.status >= 500) {
        logger.error({ err: error, requestId }, "http exception (5xx)");
        if (sentryEnabled) Sentry.captureException(error, { tags: { requestId } });
      }
      return c.json(error.toResponse(), error.status as 400);
    }

    logger.error({ err: error, requestId }, "unhandled error");
    if (sentryEnabled) {
      Sentry.captureException(error, {
        tags: { requestId },
        user: c.get("session") ? { id: c.get("session")?.user.id } : undefined
      });
    }
    return c.json({ code: "INTERNAL_ERROR", message: "Something went wrong", requestId }, 500);
  };
}
