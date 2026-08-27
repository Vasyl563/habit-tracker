import { Redis, type RedisOptions } from "ioredis";

export type { RedisOptions } from "ioredis";
export { Redis } from "ioredis";
export { sseUserChannel } from "./channels.js";

export type RedisPurpose =
  /** cache-aside, rate limiting, publish() — normal commands */
  | "general"
  /** BullMQ requires maxRetriesPerRequest: null so workers survive Redis blips */
  | "bullmq"
  /** a connection in SUBSCRIBE mode can run no other command — keep it separate */
  | "subscriber";

/**
 * One factory, three purposes (L8 cache, L9 rate limit, L11 queues + pub/sub).
 * Redis is a single-threaded key-value store; every purpose here maps to
 * plain commands — no magic, read the ioredis call and you know what runs.
 */
export function createRedis(url: string, purpose: RedisPurpose = "general"): Redis {
  const options: RedisOptions = {
    lazyConnect: false,
    enableReadyCheck: true,
    connectionName: `habit-tracker:${purpose}`
  };
  if (purpose === "bullmq") {
    options.maxRetriesPerRequest = null;
  }
  const client = new Redis(url, options);
  client.on("error", (err) => {
    // Don't crash on transient errors; ioredis reconnects. Log at the call site.
    if (process.env.NODE_ENV !== "test") {
      console.error(`[redis:${purpose}] ${err.message}`);
    }
  });
  return client;
}
