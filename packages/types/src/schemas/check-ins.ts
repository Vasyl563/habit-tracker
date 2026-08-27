import { z } from "zod";
import { cursorQuerySchema, isoDateSchema, isoDateTimeSchema, uuidSchema } from "./common.js";

export const checkInSchema = z.object({
  id: uuidSchema,
  habitId: uuidSchema,
  date: isoDateSchema,
  note: z.string().nullable(),
  photoFileId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema
});
export type CheckInDto = z.infer<typeof checkInSchema>;

export const createCheckInSchema = z.object({
  habitId: uuidSchema,
  /** Defaults to "today" (UTC) on the server when omitted. */
  date: isoDateSchema.optional(),
  note: z.string().trim().max(280).nullable().optional(),
  photoFileId: uuidSchema.nullable().optional()
});
export type CreateCheckInInput = z.infer<typeof createCheckInSchema>;

/** Response of a check-in: the row + the streak it produced (atomic, L7 tx). */
export const checkInResultSchema = z.object({
  checkIn: checkInSchema,
  streak: z.object({
    current: z.number().int(),
    longest: z.number().int(),
    /** true when this check-in crossed a milestone (7 / 30 / 100 …) */
    milestone: z.number().int().nullable()
  })
});
export type CheckInResultDto = z.infer<typeof checkInResultSchema>;

export const deleteCheckInSchema = z.object({
  habitId: uuidSchema,
  date: isoDateSchema
});

export const listCheckInsQuerySchema = cursorQuerySchema.extend({
  habitId: uuidSchema,
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional()
});
export type ListCheckInsQuery = z.infer<typeof listCheckInsQuerySchema>;
