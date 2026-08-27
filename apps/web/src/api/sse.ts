import type { SseEvent } from "@habit-tracker/types";
import { useEffect, useRef, useState } from "react";

/**
 * One EventSource per tab (L11). The browser reconnects by itself and sends
 * Last-Event-ID; we only parse events and hand them to a callback.
 */
export function useSse(onEvent: (event: SseEvent) => void, enabled = true) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [status, setStatus] = useState<"idle" | "open" | "reconnecting">("idle");

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/sse/stream", { withCredentials: true });
    const dispatch = (e: MessageEvent<string>) => {
      try {
        handler.current(JSON.parse(e.data) as SseEvent);
      } catch {
        /* ignore malformed */
      }
    };
    for (const type of ["notification", "unread-count", "file.progress", "file.done"]) {
      es.addEventListener(type, dispatch as EventListener);
    }
    es.onopen = () => setStatus("open");
    es.onerror = () => setStatus("reconnecting");
    return () => es.close();
  }, [enabled]);

  return status;
}
