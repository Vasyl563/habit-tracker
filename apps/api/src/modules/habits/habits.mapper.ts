import type { Habit } from "@habit-tracker/db";
import type { HabitDto } from "@habit-tracker/types";

export function toHabitDto(habit: Habit): HabitDto {
  return {
    id: habit.id,
    userId: habit.userId,
    name: habit.name,
    description: habit.description,
    schedule: habit.schedule,
    weekdays: habit.weekdays,
    visibility: habit.visibility,
    currentStreak: habit.currentStreak,
    longestStreak: habit.longestStreak,
    totalCheckIns: habit.totalCheckIns,
    lastCheckInDate: habit.lastCheckInDate,
    archivedAt: habit.archivedAt?.toISOString() ?? null,
    createdAt: habit.createdAt.toISOString(),
    updatedAt: habit.updatedAt.toISOString()
  };
}
