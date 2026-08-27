import type { AuthSession } from "@habit-tracker/auth";
import type { Logger } from "@habit-tracker/logger";

/**
 * Hono's per-request variables — what our middleware chain puts on `c`.
 * `c.get("session")` / `c.get("logger")` are typed everywhere thanks to this.
 */
export type AppEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
    session: AuthSession | null;
    ip: string;
  };
};
