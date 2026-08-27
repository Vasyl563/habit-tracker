import { serveStatic } from "@hono/node-server/serve-static";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, ValidationError as ORPCValidationError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import {
  experimental_ZodSmartCoercionPlugin as ZodSmartCoercionPlugin,
  ZodToJsonSchemaConverter
} from "@orpc/zod/zod4";
import * as Sentry from "@sentry/node";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./app-env.js";
import type { Container } from "./container.js";
import type { RequestContext } from "./lib/orpc.js";
import { authRateLimit } from "./middleware/auth-rate-limit.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { sessionLoader } from "./middleware/session.js";
import { createFilesDownloadRoutes } from "./modules/files/files.download.js";
import { createHealthRoutes } from "./modules/health/health.controller.js";
import { createSseRoutes } from "./modules/sse/sse.controller.js";
import { createStripeWebhookRoutes } from "./modules/webhooks/stripe-webhook.controller.js";
import { router } from "./router.js";

/**
 * Assembles the HTTP surface (L3/L8/L9/L10):
 *
 *   /health                 liveness + dependency checks
 *   /api/auth/*             better-auth (sign-up, sign-in, callbacks, session…)
 *   /webhooks/stripe        signed webhook, no session
 *   /sse/stream             server-sent events, session-guarded
 *   /v1/*                   REST-style OpenAPI surface of the oRPC router
 *   /v1/docs                Scalar UI generated from the same Zod schemas
 *   /v1/files/:id/content   streaming download (plain Hono route)
 *   /rpc/*                  oRPC's own protocol for the typed web client
 */
export function createApp(container: Container): Hono<AppEnv> {
  const { env, logger, auth, services, rateLimiter, sseHub, storage, db, redis } = container;
  const sentryEnabled = Boolean(env.SENTRY_DSN);
  const app = new Hono<AppEnv>();

  // ── cross-cutting middleware, in order ────────────────────────────────────
  app.onError(errorHandler(logger, sentryEnabled));
  app.use("*", requestId);
  app.use("*", requestLogger(logger));
  app.use(
    "*",
    cors({
      origin: [env.WEB_URL], // exact allow-list — never "*" with credentials (L10)
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "x-request-id", "Last-Event-ID"],
      exposeHeaders: ["x-request-id", "Retry-After"],
      maxAge: 600
    })
  );

  // ── routes that must NOT depend on a session ──────────────────────────────
  app.route("/", createHealthRoutes(db, redis, env.GIT_SHA));
  app.route("/", createStripeWebhookRoutes(services.stripeWebhook, env.STRIPE_WEBHOOK_SECRET));

  // credential-stuffing defence: sliding window by IP and by email (L9)
  const authLimit = authRateLimit(rateLimiter, { limit: 10, windowSeconds: 60 });
  app.use("/api/auth/sign-in/*", authLimit);
  app.use("/api/auth/sign-up/*", authLimit);
  app.use("/api/auth/request-password-reset", authLimit);
  app.use("/api/auth/forget-password", authLimit);
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // ── everything below sees `c.get("session")` ─────────────────────────────
  app.use("*", sessionLoader(auth));
  app.route("/", createSseRoutes(sseHub, services.notifications));
  app.route("/v1", createFilesDownloadRoutes(services.files, storage));

  // ── oRPC: two handlers, one router ────────────────────────────────────────
  const buildContext = (c: Context<AppEnv>): RequestContext => ({
    requestId: c.get("requestId"),
    logger: c.get("logger"),
    ip: c.get("ip"),
    session: c.get("session"),
    services,
    rateLimiter
  });

  /** log + Sentry for anything unexpected; ORPCErrors < 500 are expected traffic */
  const logUnexpected = (error: unknown, ctx: Partial<RequestContext>) => {
    if (error instanceof ORPCError && error.status < 500) return;
    (ctx.logger ?? logger).error(
      { err: error, requestId: ctx.requestId },
      "unhandled error in procedure"
    );
    if (sentryEnabled) {
      Sentry.captureException(error, {
        tags: { requestId: ctx.requestId },
        user: ctx.session ? { id: ctx.session.user.id } : undefined
      });
    }
  };

  /** oRPC's own input-validation failure → our VALIDATION_ERROR envelope */
  const unifyValidationErrors = (error: unknown) => {
    if (
      error instanceof ORPCError &&
      error.code === "BAD_REQUEST" &&
      error.cause instanceof ORPCValidationError
    ) {
      const issues = (error.cause.issues as { path?: PropertyKey[]; message: string }[]).map(
        (i) => ({
          path: i.path ?? [],
          message: i.message
        })
      );
      throw new ORPCError("VALIDATION_ERROR", {
        status: 400,
        message: "Invalid input",
        data: issues,
        cause: error.cause
      });
    }
  };

  const openApiHandler = new OpenAPIHandler(router, {
    plugins: [
      new ZodSmartCoercionPlugin(), // "?limit=20" → 20 for z.number() inputs
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
        docsPath: "/docs",
        specPath: "/openapi.json",
        specGenerateOptions: {
          info: {
            title: "Habit Tracker API",
            version: "1.0.0",
            description:
              "Course project — Habit Tracker with Friends. Generated from the same Zod schemas that validate every request."
          },
          servers: [{ url: `${env.API_URL}/v1` }]
        }
      })
    ],
    interceptors: [onError((error, { context }) => logUnexpected(error, context))],
    clientInterceptors: [onError((error) => unifyValidationErrors(error))],
    // the unified envelope from L9 — same shape as plain Hono errors
    customErrorResponseBodyEncoder: (error) => ({
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { details: error.data })
    })
  });

  const rpcHandler = new RPCHandler(router, {
    interceptors: [onError((error, { context }) => logUnexpected(error, context))],
    clientInterceptors: [onError((error) => unifyValidationErrors(error))]
  });

  app.use("/v1/*", async (c, next) => {
    const { matched, response } = await openApiHandler.handle(c.req.raw, {
      prefix: "/v1",
      context: buildContext(c)
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });

  app.use("/rpc/*", async (c, next) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: "/rpc",
      context: buildContext(c)
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });

  app.get("/docs", (c) => c.redirect("/v1/docs"));

  if (env.WEB_DIST_DIR) {
    // Production (L14): the api serves the built SPA from the same origin —
    // cookies just work, CORS is moot, one URL for app + API. Static files
    // first, then the SPA fallback (client-side routes like /habits).
    app.use("*", serveStatic({ root: env.WEB_DIST_DIR }));
    app.get("*", serveStatic({ root: env.WEB_DIST_DIR, path: "index.html" }));
  } else {
    app.get("/", (c) =>
      c.json({
        name: "habit-tracker-api",
        docs: "/v1/docs",
        health: "/health",
        requestId: c.get("requestId")
      })
    );
  }

  app.notFound((c) =>
    c.json({ code: "NOT_FOUND", message: `No route for ${c.req.method} ${c.req.path}` }, 404)
  );

  return app;
}
