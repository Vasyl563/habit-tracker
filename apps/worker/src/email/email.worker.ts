import type { Logger } from "@habit-tracker/logger";
import {
  UnrecoverableError as BullUnrecoverable,
  type EmailJob,
  emailJobSchema,
  QUEUE_NAMES,
  Worker
} from "@habit-tracker/queues";
import type { Redis } from "@habit-tracker/redis";
import { UnrecoverableError } from "@habit-tracker/shared";
import type { EmailSender } from "./sender.js";

/**
 * Consumer for the `email` queue (L11). One job = one email. Transient
 * failures throw → BullMQ retries with exponential backoff; permanent ones
 * (bad address, provider validation) become UnrecoverableError → straight to
 * the failed set (our dead-letter queue), logged at ERROR for a human.
 */
export function startEmailWorker(connection: Redis, sender: EmailSender, logger: Logger) {
  const worker = new Worker<EmailJob>(
    QUEUE_NAMES.email,
    async (job) => {
      const log = logger.child({
        queue: QUEUE_NAMES.email,
        jobId: job.id,
        attempt: job.attemptsMade + 1
      });
      const parsed = emailJobSchema.safeParse(job.data);
      if (!parsed.success) {
        // malformed payload can never succeed — don't burn retries on it
        throw new BullUnrecoverable(`invalid email job: ${parsed.error.message}`);
      }
      const { to, subject, text, html, template } = parsed.data;
      try {
        const { id } = await sender.send({ to, subject, text, html });
        log.info({ to, template, providerId: id, provider: sender.name }, "email sent");
      } catch (error) {
        if (error instanceof UnrecoverableError) throw new BullUnrecoverable(error.message);
        throw error;
      }
    },
    { connection, concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    // after the last attempt this IS the dead-letter landing → ERROR level
    const final = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : true;
    logger[final ? "error" : "warn"](
      {
        queue: QUEUE_NAMES.email,
        jobId: job?.id,
        attempts: job?.attemptsMade,
        err,
        deadLetter: final
      },
      final ? "email job moved to dead-letter (failed set)" : "email job failed — will retry"
    );
  });
  worker.on("error", (err) => logger.error({ err }, "email worker error"));
  return worker;
}
