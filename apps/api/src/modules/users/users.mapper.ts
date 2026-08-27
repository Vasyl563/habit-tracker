import type { User, UserSettings } from "@habit-tracker/db";
import type { MeDto, PublicUserDto } from "@habit-tracker/types";

/**
 * Mappers (L8): the ONLY place an entity becomes a DTO. Never return the DB
 * row directly — the row has `email`/`plan`/internal columns; the DTO is what
 * the API promises. Pure functions, trivially testable.
 */
export function toPublicUserDto(user: User): PublicUserDto {
  return {
    id: user.id,
    name: user.name,
    image: user.image,
    bio: user.bio,
    createdAt: user.createdAt.toISOString()
  };
}

export function toMeDto(user: User, settings: UserSettings | null): MeDto {
  return {
    ...toPublicUserDto(user),
    email: user.email,
    emailVerified: user.emailVerified,
    plan: user.plan,
    settings: {
      timezone: settings?.timezone ?? "UTC",
      emailNotifications: settings?.emailNotifications ?? true,
      weeklyDigest: settings?.weeklyDigest ?? false
    }
  };
}
