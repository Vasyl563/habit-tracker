import { z } from "zod";
import { cursorQuerySchema, isoDateTimeSchema, uuidSchema } from "./common.js";

/** `type` is a code the frontend renders per kind — never free text. */
export const notificationTypeSchema = z.enum([
  "follow.created",
  "streak.milestone",
  "payment.succeeded",
  "payment.failed",
  "file.ready",
  "file.rejected"
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationSchema = z.object({
  id: uuidSchema,
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string().nullable(),
  /** deep-link params, ids — whatever the click destination needs */
  data: z.record(z.string(), z.unknown()).nullable(),
  /** timestamp, not boolean — answers "when did they see it" */
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = cursorQuerySchema.extend({
  unreadOnly: z.boolean().default(false)
});

export const unreadCountSchema = z.object({ count: z.number().int().min(0) });

/** Shape of every message pushed over SSE (`/sse/stream`). */
export const sseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notification"), notification: notificationSchema }),
  z.object({ type: z.literal("unread-count"), count: z.number().int() }),
  z.object({
    type: z.literal("file.progress"),
    fileId: uuidSchema,
    step: z.string(),
    pct: z.number().int().min(0).max(100)
  }),
  z.object({
    type: z.literal("file.done"),
    fileId: uuidSchema,
    status: z.enum(["ready", "rejected"]),
    reason: z.string().optional()
  })
]);
export type SseEvent = z.infer<typeof sseEventSchema>;
