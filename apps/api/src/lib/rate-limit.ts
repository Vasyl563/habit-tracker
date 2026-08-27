import type { Redis } from "@habit-tracker/redis";
import { RateLimitError } from "./errors.js";

export interface RateLimitRule {
  /** max requests… */
  limit: number;
  /** …per this many seconds (sliding) */
  windowSeconds: number;
}

export interface RateLimiter {
  /** throws RateLimitError (429) when `key` exceeded the rule inside `scope` */
  consume(scope: string, key: string, rule: RateLimitRule): Promise<{ remaining: number }>;
}

/**
 * Sliding-window rate limiting with a Redis sorted set (L9).
 *
 * Every request adds a member scored with its timestamp; we drop members
 * older than the window and count what's left. Four commands in one
 * MULTI/EXEC → atomic, no edge-of-bucket bursts like a fixed window.
 *
 *   ZREMRANGEBYSCORE rl:scope:key 0 <now - window>   drop old entries
 *   ZADD             rl:scope:key <now> <now:rand>    log this request
 *   ZCARD            rl:scope:key                     count the window
 *   EXPIRE           rl:scope:key <window>            auto-cleanup
 */
export function createRateLimiter(redis: Redis): RateLimiter {
  return {
    async consume(scope, key, { limit, windowSeconds }) {
      const now = Date.now();
      const cutoff = now - windowSeconds * 1_000;
      const redisKey = `rl:${scope}:${key}`;
      const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

      const results = await redis
        .multi()
        .zremrangebyscore(redisKey, 0, cutoff)
        .zadd(redisKey, now, member)
        .zcard(redisKey)
        .expire(redisKey, windowSeconds)
        .exec();

      const count = Number(results?.[2]?.[1] ?? 0);
      if (count > limit) {
        // oldest entry tells the client when a slot frees up
        const oldest = await redis.zrange(redisKey, "0", "0", "WITHSCORES");
        const oldestScore = Number(oldest[1] ?? now);
        const retryAfter = Math.max(
          1,
          Math.ceil((oldestScore + windowSeconds * 1_000 - now) / 1_000)
        );
        throw new RateLimitError(retryAfter);
      }
      return { remaining: Math.max(0, limit - count) };
    }
  };
}
