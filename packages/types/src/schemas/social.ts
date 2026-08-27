import { z } from "zod";
import {
  cursorQuerySchema,
  isoDateSchema,
  isoDateTimeSchema,
  offsetQuerySchema,
  uuidSchema
} from "./common.js";
import { habitVisibilitySchema } from "./habits.js";
import { publicUserSchema } from "./users.js";

export const followTargetSchema = z.object({ userId: uuidSchema });

export const listFollowsQuerySchema = offsetQuerySchema.extend({ userId: uuidSchema });

/** One line in the activity feed: who did what, when — visibility already applied. */
export const feedItemSchema = z.object({
  id: uuidSchema, // check-in id
  user: publicUserSchema.pick({ id: true, name: true, image: true }),
  habit: z.object({
    id: uuidSchema,
    name: z.string(),
    visibility: habitVisibilitySchema,
    currentStreak: z.number().int()
  }),
  date: isoDateSchema,
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema
});
export type FeedItemDto = z.infer<typeof feedItemSchema>;

export const feedQuerySchema = cursorQuerySchema;
