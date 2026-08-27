import type { Redis } from "@habit-tracker/redis";
import { type JobsOptions, Queue } from "bullmq";
import { z } from "zod";
import type { EventJob } from "./events.js";

export type { Job, JobsOptions, WorkerOptions } from "bullmq";
export { Queue, UnrecoverableError, Worker } from "bullmq";
export * from "./events.js";

/**
 * Queue definitions shared by the api (producers) and the worker (consumers).
 * One queue per class of work; a worker picks up a queue by name.
 */
export const QUEUE_NAMES = {
  /** transactional emails — welcome, verification, receipts */
  email: "email",
  /** domain events from the outbox → notification fan-out */
  events: "events",
  /** post-upload processing — magic bytes, thumbnails */
  files: "files"
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  emailSend: "email.send",
  eventDispatch: "event.dispatch",
  fileProcess: "file.process"
} as const;

export const emailJobSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().optional(),
  /** free-form tag for logs/metrics: 'welcome' | 'verify-email' | 'reset-password' | … */
  template: z.string().optional()
});
export type EmailJob = z.infer<typeof emailJobSchema>;

export const fileJobSchema = z.object({ fileId: z.uuid(), userId: z.uuid() });
export type FileJob = z.infer<typeof fileJobSchema>;

/**
 * Sensible defaults (L11): retry with exponential backoff (BullMQ adds
 * jitter), keep the last N completed/failed jobs for inspection, nothing else.
 * Per-job overrides are allowed at `queue.add(name, data, options)`.
 */
export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 1_000 }
};

export interface Queues {
  email: Queue<EmailJob>;
  events: Queue<EventJob>;
  files: Queue<FileJob>;
}

/** Producers. `connection` must be created with `createRedis(url, "bullmq")`. */
export function createQueues(connection: Redis): Queues {
  const opts = { connection, defaultJobOptions };
  return {
    email: new Queue<EmailJob>(QUEUE_NAMES.email, opts),
    events: new Queue<EventJob>(QUEUE_NAMES.events, opts),
    files: new Queue<FileJob>(QUEUE_NAMES.files, opts)
  };
}

export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}

/**
 * Convenience producers with idempotency keys baked in (same jobId → BullMQ
 * ignores the dupe). NB: BullMQ forbids ":" in custom job ids, hence "-".
 */
export const enqueue = {
  email(queues: Queues, data: EmailJob, jobId?: string) {
    return queues.email.add(
      JOB_NAMES.emailSend,
      emailJobSchema.parse(data),
      jobId ? { jobId } : {}
    );
  },
  event(queues: Queues, event: EventJob) {
    return queues.events.add(JOB_NAMES.eventDispatch, event, { jobId: `event-${event.id}` });
  },
  fileProcess(queues: Queues, data: FileJob) {
    return queues.files.add(JOB_NAMES.fileProcess, data, { jobId: `file-${data.fileId}` });
  }
};
