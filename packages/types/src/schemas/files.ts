import { z } from "zod";
import { cursorQuerySchema, isoDateTimeSchema, uuidSchema } from "./common.js";

export const fileKindSchema = z.enum(["avatar", "checkin_photo"]);
export type FileKind = z.infer<typeof fileKindSchema>;

/** pending → uploaded (client acked) → ready | rejected (worker verdict) */
export const fileStatusSchema = z.enum(["pending", "uploaded", "ready", "rejected"]);
export type FileStatus = z.infer<typeof fileStatusSchema>;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const allowedContentTypeSchema = z.enum(ALLOWED_IMAGE_TYPES);

export const fileSchema = z.object({
  id: uuidSchema,
  kind: fileKindSchema,
  status: fileStatusSchema,
  originalName: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  rejectReason: z.string().nullable(),
  /** Presigned GET, short-lived — only present when status is `ready`. */
  downloadUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  createdAt: isoDateTimeSchema
});
export type FileDto = z.infer<typeof fileSchema>;

/** Step 1 of the presigned flow: "I want to upload X" — metadata only. */
export const presignUploadSchema = z.object({
  kind: fileKindSchema,
  filename: z.string().trim().min(1).max(200),
  contentType: allowedContentTypeSchema,
  size: z.number().int().positive()
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

export const presignUploadResultSchema = z.object({
  fileId: uuidSchema,
  /** PUT the raw bytes here — the browser talks to storage directly */
  uploadUrl: z.string(),
  /** Headers the client must send with the PUT (they're part of the signature) */
  headers: z.record(z.string(), z.string()),
  expiresInSeconds: z.number().int()
});
export type PresignUploadResult = z.infer<typeof presignUploadResultSchema>;

export const fileIdSchema = z.object({ id: uuidSchema });
export const listFilesQuerySchema = cursorQuerySchema.extend({
  kind: fileKindSchema.optional()
});
