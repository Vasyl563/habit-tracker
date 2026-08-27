import { type DbOrTx, outbox } from "@habit-tracker/db";
import type { DomainEvent } from "@habit-tracker/queues";

/**
 * Transactional outbox writer (L11). Call it with the SAME `tx` as the
 * business write: if the transaction rolls back, the event never existed;
 * if it commits, the worker's poller is guaranteed to pick it up.
 */
export async function writeOutboxEvent(
  tx: DbOrTx,
  aggregate: { type: string; id: string },
  event: DomainEvent
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(outbox)
    .values({
      aggregateType: aggregate.type,
      aggregateId: aggregate.id,
      eventType: event.type,
      payload: event.payload
    })
    .returning({ id: outbox.id });
  if (!row) throw new Error("outbox insert returned no row");
  return row;
}
