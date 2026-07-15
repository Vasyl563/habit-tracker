// Domain types shared across apps — the entity shapes only, no db client.
// Everything is derived from the Drizzle schema, so the types can never drift
// from the tables.
export type {
  User,
  NewUser,
  Habit,
  NewHabit,
  CheckIn,
  NewCheckIn,
  Follow,
  NewFollow
} from "@habit-tracker/db";
