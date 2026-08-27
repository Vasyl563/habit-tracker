import { z } from "zod";

/**
 * Domain events (L11). Producers write them to the `outbox` table inside the
 * business transaction; the worker's poller moves them to the `events` queue;
 * the fan-out worker turns them into notifications (in-app + email + SSE).
 *
 * `type` doubles as the notification code the frontend renders per kind.
 */
export const domainEventPayloads = {
  "user.created": z.object({ userId: z.uuid(), email: z.email(), name: z.string() }),
  "follow.created": z.object({ followerId: z.uuid(), followeeId: z.uuid() }),
  "checkin.created": z.object({
    checkInId: z.uuid(),
    habitId: z.uuid(),
    habitName: z.string(),
    userId: z.uuid(),
    date: z.iso.date(),
    streakBefore: z.number().int(),
    streakAfter: z.number().int(),
    milestone: z.number().int().nullable()
  }),
  "payment.succeeded": z.object({
    paymentId: z.uuid(),
    userId: z.uuid(),
    amount: z.number().int(),
    currency: z.string()
  }),
  "payment.failed": z.object({
    paymentId: z.uuid(),
    userId: z.uuid(),
    reason: z.string().nullable()
  }),
  "file.processed": z.object({
    fileId: z.uuid(),
    userId: z.uuid(),
    status: z.enum(["ready", "rejected"]),
    reason: z.string().nullable()
  })
} as const;

export type DomainEventType = keyof typeof domainEventPayloads;
export type DomainEventPayload<T extends DomainEventType> = z.infer<
  (typeof domainEventPayloads)[T]
>;

/** A typed event = { type, payload } — what services hand to `writeOutboxEvent`. */
export type DomainEvent = {
  [T in DomainEventType]: { type: T; payload: DomainEventPayload<T> };
}[DomainEventType];

/** What travels on the queue: the outbox row, flattened. */
export const eventJobSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  aggregateType: z.string(),
  aggregateId: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true })
});
export type EventJob = z.infer<typeof eventJobSchema>;

/** Validate a queue job's payload against its declared type. */
export function parseEventPayload<T extends DomainEventType>(
  type: T,
  payload: unknown
): DomainEventPayload<T> {
  return domainEventPayloads[type].parse(payload) as DomainEventPayload<T>;
}
export function isDomainEventType(type: string): type is DomainEventType {
  return type in domainEventPayloads;
}
