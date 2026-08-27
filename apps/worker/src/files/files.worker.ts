import { type Db, files, users } from "@habit-tracker/db";
import type { Logger } from "@habit-tracker/logger";
import {
  UnrecoverableError as BullUnrecoverable,
  enqueue,
  type FileJob,
  fileJobSchema,
  QUEUE_NAMES,
  type Queues,
  Worker
} from "@habit-tracker/queues";
import { type Redis, sseUserChannel } from "@habit-tracker/redis";
import type { Storage } from "@habit-tracker/storage";
import { ALLOWED_IMAGE_TYPES, type SseEvent } from "@habit-tracker/types";
import { eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

const THUMB_SIZE = 256;

/**
 * Post-upload processing (L12 step 5, with L11 machinery):
 *
 *   uploaded ──► HEAD (size cap) ──► magic bytes (file-type) ──► sharp:
 *   dimensions + 256px webp thumbnail ──► status=ready | rejected
 *
 * Progress is PUBLISHed to the user's SSE channel after every step, so the
 * browser shows a live bar; the verdict also becomes a `file.processed`
 * event → in-app notification. Everything the *client said* about the file
 * (content-type, extension) is only a suggestion — the bytes decide.
 */
export function startFilesWorker(
  connection: Redis,
  db: Db,
  storage: Storage,
  queues: Queues,
  publisher: Redis,
  logger: Logger,
  opts: { maxBytes: number; apiUrl: string }
) {
  const publish = (userId: string, event: SseEvent) =>
    publisher.publish(sseUserChannel(userId), JSON.stringify(event));

  const progress = (userId: string, fileId: string, step: string, pct: number) =>
    publish(userId, { type: "file.progress", fileId, step, pct });

  async function reject(fileId: string, userId: string, key: string, reason: string, log: Logger) {
    await storage.delete(key).catch((err) => log.warn({ err }, "could not delete rejected object"));
    await db
      .update(files)
      .set({ status: "rejected", rejectReason: reason })
      .where(eq(files.id, fileId));
    await publish(userId, { type: "file.done", fileId, status: "rejected", reason });
    await enqueue.event(queues, {
      id: fileId, // one verdict per file → the file id is a fine event id
      type: "file.processed",
      aggregateType: "file",
      aggregateId: fileId,
      payload: { fileId, userId, status: "rejected", reason },
      createdAt: new Date().toISOString()
    });
    log.warn({ fileId, reason }, "file rejected");
  }

  const worker = new Worker<FileJob>(
    QUEUE_NAMES.files,
    async (job) => {
      const log = logger.child({
        queue: QUEUE_NAMES.files,
        jobId: job.id,
        fileId: job.data.fileId
      });
      const parsed = fileJobSchema.safeParse(job.data);
      if (!parsed.success) throw new BullUnrecoverable(`invalid file job: ${parsed.error.message}`);
      const { fileId, userId } = parsed.data;

      const file = await db.query.files.findFirst({ where: eq(files.id, fileId) });
      if (!file) throw new BullUnrecoverable(`file ${fileId} does not exist`);
      if (file.status !== "uploaded") {
        log.info({ status: file.status }, "file already processed — skipping (idempotent)");
        return;
      }

      // 1) the honest check: real size in storage
      await progress(userId, fileId, "checking size", 10);
      const head = await storage.head(file.key);
      if (!head) return reject(fileId, userId, file.key, "object missing in storage", log);
      if (head.size > opts.maxBytes) return reject(fileId, userId, file.key, "file too large", log);

      // 2) magic bytes — the client's Content-Type is a suggestion, not a promise
      await progress(userId, fileId, "verifying format", 35);
      const headBytes = await storage.getHead(file.key, 4_100);
      const detected = await fileTypeFromBuffer(headBytes);
      if (!detected || !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(detected.mime)) {
        return reject(
          fileId,
          userId,
          file.key,
          `content is ${detected?.mime ?? "unknown"}, not an allowed image type`,
          log
        );
      }

      // 3) dimensions + thumbnail (files are ≤ 5 MB → buffering is fine here)
      await progress(userId, fileId, "generating thumbnail", 60);
      const stream = await storage.getStream(file.key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const original = Buffer.concat(chunks);

      const meta = await sharp(original).metadata();
      const thumb = await sharp(original)
        .rotate() // honour EXIF orientation
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const thumbnailKey = `${file.key.replace(/\.[a-z0-9]+$/i, "")}.thumb.webp`;
      await storage.put(thumbnailKey, thumb, "image/webp");

      // 4) verdict
      await progress(userId, fileId, "finishing", 90);
      await db
        .update(files)
        .set({
          status: "ready",
          contentType: detected.mime, // trust the bytes over the client
          width: meta.width ?? null,
          height: meta.height ?? null,
          thumbnailKey
        })
        .where(eq(files.id, fileId));

      if (file.kind === "avatar") {
        await db
          .update(users)
          .set({ image: `${opts.apiUrl}/v1/files/${fileId}/content` })
          .where(eq(users.id, userId));
      }

      await publish(userId, { type: "file.done", fileId, status: "ready" });
      await enqueue.event(queues, {
        id: fileId,
        type: "file.processed",
        aggregateType: "file",
        aggregateId: fileId,
        payload: { fileId, userId, status: "ready", reason: null },
        createdAt: new Date().toISOString()
      });
      log.info({ mime: detected.mime, width: meta.width, height: meta.height }, "file ready");
    },
    { connection, concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    const final = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : true;
    logger[final ? "error" : "warn"](
      {
        queue: QUEUE_NAMES.files,
        jobId: job?.id,
        attempts: job?.attemptsMade,
        err,
        deadLetter: final
      },
      final ? "file job moved to dead-letter (failed set)" : "file job failed — will retry"
    );
  });
  worker.on("error", (err) => logger.error({ err }, "files worker error"));
  return worker;
}
