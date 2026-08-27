import { randomUUID } from "node:crypto";
import type { FileRow } from "@habit-tracker/db";
import { enqueue, type Queues } from "@habit-tracker/queues";
import type { Storage } from "@habit-tracker/storage";
import {
  ALLOWED_IMAGE_TYPES,
  type CursorPage,
  type FileDto,
  type FileKind,
  type PresignUploadInput,
  type PresignUploadResult
} from "@habit-tracker/types";
import { decodeCursor, toCursorPage } from "../../lib/cursor.js";
import {
  NotFoundError,
  PayloadTooLargeError,
  UnprocessableError,
  UnsupportedMediaTypeError
} from "../../lib/errors.js";
import type { FilesRepository } from "./files.repository.js";

const PRESIGN_TTL_SECONDS = 5 * 60; // upload URL lives 5 minutes
const DOWNLOAD_TTL_SECONDS = 10 * 60;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export class FilesService {
  constructor(
    private readonly repo: FilesRepository,
    private readonly storage: Storage,
    private readonly queues: Queues,
    private readonly maxBytes: number
  ) {}

  /**
   * Presigned upload, step 1 (L12): the API checks auth, type and size *from
   * metadata*, reserves a DB row (status=pending) and signs a PUT URL for that
   * exact key + content-type. Zero bytes touch the API.
   */
  async presignUpload(userId: string, input: PresignUploadInput): Promise<PresignUploadResult> {
    if (!ALLOWED_IMAGE_TYPES.includes(input.contentType)) {
      throw new UnsupportedMediaTypeError(input.contentType, ALLOWED_IMAGE_TYPES);
    }
    if (input.size > this.maxBytes) throw new PayloadTooLargeError(this.maxBytes);

    const id = randomUUID();
    const ext = EXT_BY_TYPE[input.contentType] ?? "bin";
    // flat key, no directories — slashes are just characters to S3
    const key = `users/${userId}/${input.kind}/${id}.${ext}`;

    await this.repo.create({
      id,
      userId,
      kind: input.kind,
      key,
      originalName: input.filename,
      contentType: input.contentType,
      size: input.size,
      status: "pending"
    });

    const uploadUrl = await this.storage.presignPut(key, {
      contentType: input.contentType,
      contentLength: input.size,
      expiresInSeconds: PRESIGN_TTL_SECONDS
    });

    return {
      fileId: id,
      uploadUrl,
      headers: { "Content-Type": input.contentType },
      expiresInSeconds: PRESIGN_TTL_SECONDS
    };
  }

  /**
   * Step 3: the client says "done". We verify the object really exists (HEAD,
   * no bytes), record the true size, and hand the rest to a BullMQ worker:
   * magic-byte validation, thumbnail, status=ready|rejected (L11 patterns).
   */
  async ack(userId: string, fileId: string): Promise<FileDto> {
    const file = await this.getOwned(userId, fileId);
    if (file.status !== "pending") return this.toDto(file);

    const head = await this.storage.head(file.key);
    if (!head) throw new UnprocessableError("Upload not found in storage — did the PUT succeed?");
    if (head.size > this.maxBytes) {
      await this.storage.delete(file.key);
      await this.repo.update(file.id, { status: "rejected", rejectReason: "too large" });
      throw new PayloadTooLargeError(this.maxBytes);
    }

    const updated = await this.repo.update(file.id, { status: "uploaded", size: head.size });
    await enqueue.fileProcess(this.queues, { fileId: file.id, userId });
    return this.toDto(updated);
  }

  async get(userId: string, fileId: string): Promise<FileDto> {
    return this.toDto(await this.getOwned(userId, fileId));
  }

  async list(
    userId: string,
    query: { kind?: FileKind; limit: number; cursor?: string }
  ): Promise<CursorPage<FileDto>> {
    const rows = await this.repo.list(userId, {
      kind: query.kind,
      limit: query.limit,
      cursor: decodeCursor(query.cursor)
    });
    const page = toCursorPage(rows, query.limit);
    return {
      items: await Promise.all(page.items.map((r) => this.toDto(r))),
      nextCursor: page.nextCursor
    };
  }

  async remove(userId: string, fileId: string): Promise<void> {
    const file = await this.getOwned(userId, fileId);
    await Promise.all([
      this.storage.delete(file.key),
      file.thumbnailKey ? this.storage.delete(file.thumbnailKey) : Promise.resolve()
    ]);
    await this.repo.remove(file.id);
  }

  /** Owner-only, except: a *ready* avatar is public (it's on the profile). */
  async getReadable(viewerId: string, fileId: string): Promise<FileRow> {
    const file = await this.repo.findById(fileId);
    if (!file) throw new NotFoundError("File");
    if (file.userId === viewerId) return file;
    if (file.kind === "avatar" && file.status === "ready") return file;
    throw new NotFoundError("File");
  }

  private async getOwned(userId: string, fileId: string): Promise<FileRow> {
    const file = await this.repo.findById(fileId);
    if (!file || file.userId !== userId) throw new NotFoundError("File");
    return file;
  }

  /** DTO + short-lived presigned GET urls (only once the worker said "ready"). */
  async toDto(file: FileRow): Promise<FileDto> {
    const ready = file.status === "ready";
    const [downloadUrl, thumbnailUrl] = await Promise.all([
      ready
        ? this.storage.presignGet(file.key, {
            expiresInSeconds: DOWNLOAD_TTL_SECONDS,
            contentType: file.contentType
          })
        : null,
      ready && file.thumbnailKey
        ? this.storage.presignGet(file.thumbnailKey, {
            expiresInSeconds: DOWNLOAD_TTL_SECONDS,
            contentType: "image/webp"
          })
        : null
    ]);
    return {
      id: file.id,
      kind: file.kind,
      status: file.status,
      originalName: file.originalName,
      contentType: file.contentType,
      size: file.size,
      width: file.width,
      height: file.height,
      rejectReason: file.rejectReason,
      downloadUrl,
      thumbnailUrl,
      createdAt: file.createdAt.toISOString()
    };
  }
}
