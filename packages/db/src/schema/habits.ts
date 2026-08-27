import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid
} from "drizzle-orm/pg-core";
import { files } from "./files.js";
import { users } from "./users.js";

// ── Enums ────────────────────────────────────────────────────────────────────
export const scheduleType = pgEnum("schedule_type", ["daily", "weekly"]);
export const habitVisibility = pgEnum("habit_visibility", ["public", "friends", "private"]);

// ── habits ───────────────────────────────────────────────────────────────────
// A user's habit. `schedule` is daily or weekly; for weekly, `weekdays` lists
// which days (0=Sun..6=Sat). Streak + counters are *denormalised* — refreshed
// inside the same transaction as the check-in write (L8), so reads are cheap.
export const habits = pgTable(
  "habits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    schedule: scheduleType("schedule").notNull().default("daily"),
    weekdays: integer("weekdays").array(),
    visibility: habitVisibility("visibility").notNull().default("private"),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    totalCheckIns: integer("total_check_ins").notNull().default(0),
    lastCheckInDate: date("last_check_in_date"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    // FK column + the default sort of the list endpoint (user_id, created_at)
    index("idx_habits_user_created").on(table.userId, table.createdAt),
    check("streaks_non_negative", sql`${table.currentStreak} >= 0 AND ${table.longestStreak} >= 0`)
  ]
);

// ── check_ins ────────────────────────────────────────────────────────────────
// One row = one habit checked in on one calendar day. The UNIQUE (habit_id,
// date) constraint enforces "one check-in per day" at the database boundary,
// not only in application code (course NFR).
export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    habitId: uuid("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    note: text("note"),
    /** optional "proof" photo — set null if the file is deleted */
    photoFileId: uuid("photo_file_id").references(() => files.id, { onDelete: "set null" }),
    // precision 3 (milliseconds): this column is a keyset-cursor key and JS
    // Dates only carry ms — with µs the cursor could never equal a stored value
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow()
  },
  (table) => [
    unique("uq_checkin_habit_date").on(table.habitId, table.date),
    // calendar view: WHERE habit_id = ? ORDER BY date DESC
    index("idx_checkins_habit_date").on(table.habitId, table.date),
    // feed: ORDER BY created_at DESC, id DESC (cursor keyset)
    index("idx_checkins_created").on(table.createdAt, table.id)
  ]
);

// ── follows (M:N users ↔ users) ──────────────────────────────────────────────
// One-way follow. Composite PK prevents duplicates; the CHECK forbids
// following yourself. Junction table = the M:N relationship of the schema.
export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followeeId] }),
    check("no_self_follow", sql`${table.followerId} <> ${table.followeeId}`),
    // "who follows X" — the reverse direction of the PK
    index("idx_follows_followee").on(table.followeeId)
  ]
);
