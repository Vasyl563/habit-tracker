import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app-env.js";
import type { RateLimiter, RateLimitRule } from "../lib/rate-limit.js";

/**
 * Rate limit for the auth endpoints (L9): keyed by IP *and* by the email in
 * the body, so neither a single attacker IP nor a single victim account can
 * be hammered. Peeks at a clone of the body — the real handler still gets it.
 */
export function authRateLimit(limiter: RateLimiter, rule: RateLimitRule) {
  return createMiddleware<AppEnv>(async (c, next) => {
    await limiter.consume("auth:ip", c.get("ip"), rule);

    if (c.req.method === "POST") {
      const email = await peekEmail(c.req.raw);
      if (email) await limiter.consume("auth:email", email, rule);
    }
    await next();
  });
}

async function peekEmail(request: Request): Promise<string | null> {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
