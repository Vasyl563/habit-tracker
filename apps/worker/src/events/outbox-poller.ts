import { type Db, outbox } from "@habit-tracker/db";
import type { Logger } from "@habit-tracker/logger";
import { enqueue, type Queues } from "@habit-tracker/queues";
import { inArray, isNull } from "drizzle-orm";

const BATCH_SIZE = 100;

/**
 * Transactional-outbox poller (L11): moves unpublished rows onto the `events`
 * queue and marks them published — inside one DB transaction.
 *
 *  - `FOR UPDATE SKIP LOCKED` lets several worker replicas poll concurrently
 *    without picking the same rows.
 *  - If the queue is down, the transaction rolls back and the rows stay
 *    unpublished → retried next tick. If we crash between enqueue and commit,
 *    the row is enqueued twice — but the jobId (`event-<id>`) dedupes it.
 *    At-least-once + idempotent consumer = effectively-once.
 */
export function startOutboxPoller(db: Db, queues: Queues, logger: Logger, intervalMs: number) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let running = false;

  async function tick(): Promise<void> {
    if (running || stopped) return;
    running = true;
    try {
      const published = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(outbox)
          .where(isNull(outbox.publishedAt))
          .orderBy(outbox.createdAt)
          .limit(BATCH_SIZE)
          .for("update", { skipLocked: true });
        if (rows.length === 0) return 0;

        for (const row of rows) {
          await enqueue.event(queues, {
            id: row.id,
            type: row.eventType,
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            payload: row.payload,
            createdAt: row.createdAt.toISOString()
          });
        }
        await tx
          .update(outbox)
          .set({ publishedAt: new Date() })
          .where(
            inArray(
              outbox.id,
              rows.map((r) => r.id)
            )
          );
        return rows.length;
      });
      if (published > 0) logger.info({ published }, "outbox: events published");
    } catch (err) {
      logger.error({ err }, "outbox: poll failed — will retry next tick");
    } finally {
      running = false;
    }
  }

  timer = setInterval(() => void tick(), intervalMs);
  void tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      // let an in-flight tick finish
      while (running) await new Promise((r) => setTimeout(r, 50));
    }
  };
}
