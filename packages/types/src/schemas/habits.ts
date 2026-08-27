import { z } from "zod";
import {
  isoDateSchema,
  isoDateTimeSchema,
  offsetQuerySchema,
  sortDirSchema,
  uuidSchema
} from "./common.js";

export const scheduleTypeSchema = z.enum(["daily", "weekly"]);
export type ScheduleType = z.infer<typeof scheduleTypeSchema>;

/** public → anyone · friends → mutual follows only · private → owner only */
export const habitVisibilitySchema = z.enum(["public", "friends", "private"]);
export type HabitVisibility = z.infer<typeof habitVisibilitySchema>;

/** 0 = Sunday … 6 = Saturday (JS Date#getUTCDay convention). */
export const weekdaySchema = z.number().int().min(0).max(6);

export const habitSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  schedule: scheduleTypeSchema,
  weekdays: z.array(weekdaySchema).nullable(),
  visibility: habitVisibilitySchema,
  currentStreak: z.number().int(),
  longestStreak: z.number().int(),
  totalCheckIns: z.number().int(),
  lastCheckInDate: isoDateSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
});
export type HabitDto = z.infer<typeof habitSchema>;

const habitBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  schedule: scheduleTypeSchema.default("daily"),
  weekdays: z.array(weekdaySchema).min(1).max(7).nullable().optional(),
  visibility: habitVisibilitySchema.default("private")
});

/** Cross-field rule (Zod `refine`): weekly habits must say which days. */
const requireWeekdaysForWeekly = (v: { schedule?: string; weekdays?: number[] | null }) =>
  v.schedule !== "weekly" || (Array.isArray(v.weekdays) && v.weekdays.length > 0);

export const createHabitSchema = habitBody.refine(requireWeekdaysForWeekly, {
  message: "weekly habits need at least one weekday",
  path: ["weekdays"]
});
export type CreateHabitInput = z.infer<typeof createHabitSchema>;

export const updateHabitSchema = habitBody
  .partial()
  .extend({ id: uuidSchema })
  .refine(requireWeekdaysForWeekly, {
    message: "weekly habits need at least one weekday",
    path: ["weekdays"]
  });
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;

export const HABIT_SORT_FIELDS = ["createdAt", "name", "currentStreak", "totalCheckIns"] as const;
export const habitSortFieldSchema = z.enum(HABIT_SORT_FIELDS);

/** Catalogue-shaped list → offset pagination + whitelisted sort + safe filters. */
export const listHabitsQuerySchema = offsetQuerySchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
  schedule: scheduleTypeSchema.optional(),
  visibility: habitVisibilitySchema.optional(),
  includeArchived: z.boolean().default(false),
  sortBy: habitSortFieldSchema.default("createdAt"),
  sortDir: sortDirSchema.default("desc")
});
export type ListHabitsQuery = z.infer<typeof listHabitsQuerySchema>;
