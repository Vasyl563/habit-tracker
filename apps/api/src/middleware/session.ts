import type { Auth } from "@habit-tracker/auth";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app-env.js";

/**
 * Loads the better-auth session from the cookie (L10) and puts it on the
 * context — `null` for anonymous callers. It does NOT reject: routes decide
 * (oRPC `authed` procedures throw 401; public routes carry on).
 */
export function sessionLoader(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("session", session ?? null);
    await next();
  });
}
