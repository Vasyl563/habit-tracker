import { z } from "zod";
import { isoDateTimeSchema, offsetQuerySchema, uuidSchema } from "./common.js";

export const userPlanSchema = z.enum(["free", "pro"]);
export type UserPlan = z.infer<typeof userPlanSchema>;

/** What *other* people may see about a user. No email, no plan. */
export const publicUserSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  image: z.string().nullable(),
  bio: z.string().nullable(),
  createdAt: isoDateTimeSchema
});
export type PublicUserDto = z.infer<typeof publicUserSchema>;

/** The caller's own account — the only place email/plan/settings appear. */
export const meSchema = publicUserSchema.extend({
  email: z.email(),
  emailVerified: z.boolean(),
  plan: userPlanSchema,
  settings: z.object({
    timezone: z.string(),
    emailNotifications: z.boolean(),
    weeklyDigest: z.boolean()
  })
});
export type MeDto = z.infer<typeof meSchema>;

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bio: z.string().trim().max(280).nullable().optional()
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const updateSettingsSchema = z.object({
  timezone: z.string().trim().min(1).max(64).optional(),
  emailNotifications: z.boolean().optional(),
  weeklyDigest: z.boolean().optional()
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/** Aggregated numbers — computed by SQL (COUNT / SUM), never by app loops. */
export const profileStatsSchema = z.object({
  habitsTracked: z.number().int(),
  totalCheckIns: z.number().int(),
  longestStreak: z.number().int(),
  followers: z.number().int(),
  following: z.number().int(),
  currentStreaks: z.array(
    z.object({
      habitId: uuidSchema,
      habitName: z.string(),
      currentStreak: z.number().int()
    })
  )
});
export type ProfileStatsDto = z.infer<typeof profileStatsSchema>;

export const profileSchema = z.object({
  user: publicUserSchema,
  stats: profileStatsSchema,
  /** Relationship between the caller and this profile. */
  viewer: z.object({
    isMe: z.boolean(),
    isFollowing: z.boolean(),
    isFollowedBy: z.boolean()
  })
});
export type ProfileDto = z.infer<typeof profileSchema>;

export const searchUsersQuerySchema = offsetQuerySchema.extend({
  /** Free-text search over name/email prefix — ILIKE is enough at this scale. */
  q: z.string().trim().min(1).max(80).optional()
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
