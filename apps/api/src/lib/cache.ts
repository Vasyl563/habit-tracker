import type { Logger } from "@habit-tracker/logger";
import type { Redis } from "@habit-tracker/redis";

/**
 * Cache-aside with Redis (L8).
 *
 *   app checks Redis → miss → reads Postgres → writes back with a TTL.
 *
 * Invalidation is the hard half. Two tools here:
 *  1. TTL — every key expires; "a bit stale" is fine for aggregates.
 *  2. Event-based — on write, either DEL the exact key, or bump a *version*
 *     that is part of the key. Bumping `habits:v:<userId>` invalidates every
 *     cached list of that user in one move, no SCAN needed (slide 16).
 *
 * Cache failures never break the request path: on Redis error we log and
 * fall through to the database.
 */
export interface Cache {
  getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
  del(...keys: string[]): Promise<void>;
  /** current version of a namespace, e.g. `habits:v:<userId>` → "3" */
  version(namespace: string): Promise<string>;
  /** invalidate everything keyed with this namespace's version */
  bumpVersion(namespace: string): Promise<void>;
}

export const CACHE_KEY_PREFIX = "v1";

export function cacheKey(...parts: (string | number | boolean | undefined | null)[]): string {
  return [CACHE_KEY_PREFIX, ...parts.filter((p) => p !== undefined && p !== null)].join(":");
}

/** Deterministic key fragment for a query object (sorted keys). */
export function hashQuery(query: Record<string, unknown>): string {
  const sorted = Object.keys(query)
    .sort()
    .filter((k) => query[k] !== undefined)
    .map((k) => `${k}=${JSON.stringify(query[k])}`)
    .join("&");
  return Buffer.from(sorted).toString("base64url");
}

export function createCache(redis: Redis, logger: Logger): Cache {
  const stats = { hits: 0, misses: 0 };

  return {
    async getOrSet(key, ttlSeconds, loader) {
      try {
        const cached = await redis.get(key);
        if (cached !== null) {
          stats.hits += 1;
          logger.debug({ key, hits: stats.hits, misses: stats.misses }, "cache hit");
          return JSON.parse(cached) as Awaited<ReturnType<typeof loader>>;
        }
      } catch (err) {
        logger.warn({ err, key }, "cache read failed — falling through to DB");
      }

      stats.misses += 1;
      const value = await loader();

      try {
        // EX = seconds. NX not needed: last writer wins is fine for cache-aside.
        await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
      } catch (err) {
        logger.warn({ err, key }, "cache write failed");
      }
      logger.debug({ key, hits: stats.hits, misses: stats.misses }, "cache miss");
      return value;
    },

    async del(...keys) {
      if (keys.length === 0) return;
      try {
        await redis.del(...keys);
      } catch (err) {
        logger.warn({ err, keys }, "cache invalidation failed");
      }
    },

    async version(namespace) {
      try {
        return (await redis.get(cacheKey(namespace, "version"))) ?? "0";
      } catch {
        return String(Date.now()); // unknown version → effectively uncached
      }
    },

    async bumpVersion(namespace) {
      try {
        await redis.incr(cacheKey(namespace, "version"));
      } catch (err) {
        logger.warn({ err, namespace }, "cache version bump failed");
      }
    }
  };
}
