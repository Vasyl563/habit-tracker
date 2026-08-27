import type { SseEvent } from "@habit-tracker/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../../app-env.js";
import { UnauthorizedError } from "../../lib/errors.js";
import type { SseHub } from "../../lib/sse-hub.js";
import type { NotificationsService } from "../notifications/notifications.service.js";

/**
 * GET /sse/stream — one long-lived HTTP response per tab (L11).
 *
 *  - session-guarded: anonymous callers get 401 before any stream opens
 *  - per-user Redis channel via the hub — never a global channel
 *  - first event is the current unread count so the badge is right immediately
 *  - heartbeat comment every 25 s keeps proxies from closing an idle stream
 *  - clean up on abort, or the subscription (and memory) leaks
 *
 * The browser: `new EventSource('/sse/stream', { withCredentials: true })`
 * reconnects by itself and sends `Last-Event-ID`.
 */
export function createSseRoutes(hub: SseHub, notifications: NotificationsService) {
  const routes = new Hono<AppEnv>();

  routes.get("/sse/stream", async (c) => {
    const session = c.get("session");
    if (!session) throw new UnauthorizedError();
    const userId = session.user.id;
    const logger = c.get("logger");

    return streamSSE(c, async (stream) => {
      let seq = 0;
      const send = (event: SseEvent) =>
        stream.writeSSE({ event: event.type, data: JSON.stringify(event), id: String(++seq) });

      const unsubscribe = hub.subscribe(userId, (event) => {
        void send(event).catch(() => undefined);
      });

      let open = true;
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        logger.debug({ userId }, "sse: client disconnected");
      });

      await send({ type: "unread-count", count: await notifications.unreadCount(userId) });
      logger.debug({ userId }, "sse: client connected");

      while (open) {
        await stream.sleep(25_000);
        if (!open) break;
        await stream.writeSSE({ event: "ping", data: "" }); // heartbeat
      }
    });
  });

  return routes;
}
