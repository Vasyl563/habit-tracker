import type { Db } from "@habit-tracker/db";
import type { Redis } from "@habit-tracker/redis";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../../app-env.js";

/**
 * /health returns 200 only when the app AND its dependencies answer (L13):
 * orchestrators route traffic / restart containers based on it.
 */
export function createHealthRoutes(db: Db, redis: Redis, version: string | undefined) {
  const routes = new Hono<AppEnv>();

  routes.get("/health", async (c) => {
    const [pg, rd] = await Promise.allSettled([db.execute(sql`select 1`), redis.ping()]);
    const checks = {
      postgres: pg.status === "fulfilled" ? "ok" : "down",
      redis: rd.status === "fulfilled" && rd.value === "PONG" ? "ok" : "down"
    };
    const ok = Object.values(checks).every((v) => v === "ok");
    return c.json(
      { ok, checks, version: version ?? "dev", uptimeSeconds: Math.round(process.uptime()) },
      ok ? 200 : 503
    );
  });

  return routes;
}
