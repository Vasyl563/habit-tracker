import type { AuthSession, SessionUser } from "@habit-tracker/auth";
import type { Logger } from "@habit-tracker/logger";
import { contract } from "@habit-tracker/types";
import { implement, ORPCError } from "@orpc/server";
import type { Services } from "../container.js";
import { HttpException, UnauthorizedError } from "./errors.js";
import type { RateLimiter, RateLimitRule } from "./rate-limit.js";

/**
 * Per-request context handed to every oRPC procedure. Built by the Hono
 * adapter in app.ts from what the middleware chain already resolved.
 */
export interface RequestContext {
  requestId: string;
  logger: Logger;
  ip: string;
  session: AuthSession | null;
  services: Services;
  rateLimiter: RateLimiter;
}

/** Contract-first implementer — `os.habits.list.handler(...)` must match the contract. */
export const os = implement(contract).$context<RequestContext>();

/**
 * Translate our error hierarchy into oRPC's error type at the procedure
 * boundary. Services keep throwing NotFoundError etc.; here they become
 * `{ code, status, message, data }` for the RPC client, and the OpenAPI
 * handler renders them as the unified `{ code, message, details }` envelope.
 * Unknown errors pass through untouched → oRPC turns them into a generic 500
 * and our onError interceptor logs them loudly (they're programmer errors).
 */
export function toORPCError(error: unknown): unknown {
  if (error instanceof ORPCError) return error;
  if (error instanceof HttpException) {
    return new ORPCError(error.code, {
      status: error.status,
      message: error.message,
      data: error.details,
      cause: error
    });
  }
  return error;
}

const errorBoundary = os.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw toORPCError(error);
  }
});

/** 401 for anonymous callers; adds the typed `user` to the context. */
const requireAuth = os.middleware(async ({ context, next }) => {
  if (!context.session) throw toORPCError(new UnauthorizedError());
  return next({ context: { user: context.session.user as SessionUser } });
});

/**
 * Sliding-window limit per user (or per IP for anonymous callers). Only on
 * endpoints where misuse hurts — writes, expensive reads. Never on cached GETs.
 */
export const rateLimited = (scope: string, rule: RateLimitRule) =>
  os.middleware(async ({ context, next }) => {
    const key = context.session?.user.id ?? context.ip;
    try {
      await context.rateLimiter.consume(scope, key, rule);
    } catch (error) {
      throw toORPCError(error);
    }
    return next();
  });

/** Public procedures — still get the error boundary. */
export const pub = os.use(errorBoundary);
/** Procedures that need a signed-in user: `context.user` is guaranteed. */
export const authed = pub.use(requireAuth);
