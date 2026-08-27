import type { Logger } from "@habit-tracker/logger";
import { type Redis, sseUserChannel as userChannel } from "@habit-tracker/redis";
import type { SseEvent } from "@habit-tracker/types";

export type SseListener = (event: SseEvent) => void;

/**
 * Bridge between Redis Pub/Sub and open SSE connections (L11).
 *
 * The api may run as several replicas and the *worker* is a separate process,
 * so "notify user X" must cross process boundaries → Redis PUBLISH. This hub
 * holds ONE subscriber connection and fans messages out to the local
 * listeners (one per open EventSource). Subscribes/unsubscribes are
 * ref-counted so idle channels are released.
 */
export interface SseHub {
  subscribe(userId: string, listener: SseListener): () => void;
  /** publish from *this* process (services do it after a write) */
  publish(userId: string, event: SseEvent): Promise<void>;
  close(): Promise<void>;
}

export function createSseHub(subscriber: Redis, publisher: Redis, logger: Logger): SseHub {
  const listeners = new Map<string, Set<SseListener>>();

  subscriber.on("message", (channel: string, message: string) => {
    const set = listeners.get(channel);
    if (!set || set.size === 0) return;
    let event: SseEvent;
    try {
      event = JSON.parse(message) as SseEvent;
    } catch {
      logger.warn({ channel }, "sse: unparsable message");
      return;
    }
    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        logger.warn({ err, channel }, "sse: listener threw");
      }
    }
  });

  return {
    subscribe(userId, listener) {
      const channel = userChannel(userId);
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        subscriber
          .subscribe(channel)
          .catch((err) => logger.error({ err, channel }, "sse: subscribe failed"));
      }
      set.add(listener);

      return () => {
        const current = listeners.get(channel);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
          listeners.delete(channel);
          subscriber.unsubscribe(channel).catch(() => undefined);
        }
      };
    },

    async publish(userId, event) {
      await publisher.publish(userChannel(userId), JSON.stringify(event));
    },

    async close() {
      listeners.clear();
      await subscriber.quit();
    }
  };
}
