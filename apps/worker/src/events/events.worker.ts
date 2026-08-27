import { type Db, notifications, userSettings, users } from "@habit-tracker/db";
import type { Logger } from "@habit-tracker/logger";
import {
  UnrecoverableError as BullUnrecoverable,
  type EventJob,
  enqueue,
  eventJobSchema,
  isDomainEventType,
  parseEventPayload,
  QUEUE_NAMES,
  type Queues,
  Worker
} from "@habit-tracker/queues";
import { type Redis, sseUserChannel } from "@habit-tracker/redis";
import type { SseEvent } from "@habit-tracker/types";
import { and, count, eq, isNull } from "drizzle-orm";
import { type NotificationPlan, templates } from "./templates.js";

interface Recipient {
  id: string;
  email: string;
  name: string;
  emailNotifications: boolean;
}

/**
 * The notification router (L11): consumes domain events, decides who gets
 * what on which channel, and writes it out:
 *
 *   event ──► recipients ──► notifications row (idempotent on event+user)
 *                        ├─► Redis PUBLISH → SSE → live badge/toast
 *                        └─► email job (only if the user opted in)
 *
 * Every write survives being run twice — retries are safe by construction.
 */
export function startEventsWorker(
  connection: Redis,
  db: Db,
  queues: Queues,
  publisher: Redis,
  logger: Logger,
  webUrl: string
) {
  async function loadRecipient(userId: string): Promise<Recipient | null> {
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailNotifications: userSettings.emailNotifications
      })
      .from(users)
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(eq(users.id, userId));
    return row ? { ...row, emailNotifications: row.emailNotifications ?? true } : null;
  }

  async function publish(userId: string, event: SseEvent): Promise<void> {
    await publisher.publish(sseUserChannel(userId), JSON.stringify(event));
  }

  /** deliver one plan to one recipient across channels */
  async function deliver(
    eventId: string,
    recipient: Recipient,
    plan: NotificationPlan,
    log: Logger
  ) {
    // 1) in-app row — unique (event_id, user_id) makes this idempotent
    const [row] = await db
      .insert(notifications)
      .values({
        userId: recipient.id,
        eventId,
        type: plan.type,
        title: plan.title,
        body: plan.body,
        data: plan.data
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      log.info({ userId: recipient.id }, "notification already delivered — skipping");
      return;
    }

    // 2) real-time push (best-effort: an offline user simply has no listener)
    await publish(recipient.id, {
      type: "notification",
      notification: {
        id: row.id,
        type: plan.type,
        title: row.title,
        body: row.body,
        data: row.data ?? null,
        readAt: null,
        createdAt: row.createdAt.toISOString()
      }
    });
    const [unread] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, recipient.id), isNull(notifications.readAt)));
    await publish(recipient.id, { type: "unread-count", count: Number(unread?.value ?? 0) });

    // 3) email — per-user preference enforced BEFORE enqueue
    if (plan.email && recipient.emailNotifications) {
      await enqueue.email(
        queues,
        {
          to: recipient.email,
          subject: plan.email.subject,
          text: plan.email.text,
          template: plan.type
        },
        `email-${eventId}-${recipient.id}`
      );
    }
    log.info(
      {
        userId: recipient.id,
        type: plan.type,
        email: Boolean(plan.email && recipient.emailNotifications)
      },
      "notification delivered"
    );
  }

  const worker = new Worker<EventJob>(
    QUEUE_NAMES.events,
    async (job) => {
      const log = logger.child({ queue: QUEUE_NAMES.events, jobId: job.id, eventId: job.data.id });
      const parsed = eventJobSchema.safeParse(job.data);
      if (!parsed.success)
        throw new BullUnrecoverable(`invalid event job: ${parsed.error.message}`);
      const event = parsed.data;
      if (!isDomainEventType(event.type)) {
        log.warn({ type: event.type }, "unknown event type — ignoring");
        return;
      }

      switch (event.type) {
        case "follow.created": {
          const p = parseEventPayload(event.type, event.payload);
          const [follower, followee] = await Promise.all([
            loadRecipient(p.followerId),
            loadRecipient(p.followeeId)
          ]);
          if (!follower || !followee) return;
          await deliver(event.id, followee, templates.followCreated(p, follower.name, webUrl), log);
          return;
        }
        case "checkin.created": {
          const p = parseEventPayload(event.type, event.payload);
          if (p.milestone === null) return; // only milestones are worth a notification
          const owner = await loadRecipient(p.userId);
          if (!owner) return;
          await deliver(event.id, owner, templates.streakMilestone(p, webUrl), log);
          return;
        }
        case "payment.succeeded": {
          const p = parseEventPayload(event.type, event.payload);
          const user = await loadRecipient(p.userId);
          if (!user) return;
          await deliver(event.id, user, templates.paymentSucceeded(p), log);
          return;
        }
        case "payment.failed": {
          const p = parseEventPayload(event.type, event.payload);
          const user = await loadRecipient(p.userId);
          if (!user) return;
          await deliver(event.id, user, templates.paymentFailed(p), log);
          return;
        }
        case "file.processed": {
          const p = parseEventPayload(event.type, event.payload);
          const user = await loadRecipient(p.userId);
          if (!user) return;
          await deliver(event.id, user, templates.fileProcessed(p), log);
          return;
        }
        case "user.created":
          return; // welcome email is enqueued directly by the api (best-effort path)
      }
    },
    { connection, concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    const final = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : true;
    logger[final ? "error" : "warn"](
      {
        queue: QUEUE_NAMES.events,
        jobId: job?.id,
        attempts: job?.attemptsMade,
        err,
        deadLetter: final
      },
      final ? "event job moved to dead-letter (failed set)" : "event job failed — will retry"
    );
  });
  worker.on("error", (err) => logger.error({ err }, "events worker error"));
  return worker;
}
