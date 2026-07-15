import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  date,
  timestamp,
  primaryKey,
  unique,
  index,
  check
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────
export const scheduleType = pgEnum("schedule_type", ["daily", "weekly"]);
export const habitVisibility = pgEnum("habit_visibility", [
  "public",
  "friends",
  "private"
]);

// ── users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow()
});

// ── habits ───────────────────────────────────────────────────────────────────
// A user's habit. `schedule` is daily or weekly; for weekly, `weekdays` lists
// which days (0=Sun..6=Sat). Streak counters are maintained by the app.
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [index("idx_habits_user").on(table.userId)]
);

// ── check_ins ────────────────────────────────────────────────────────────────
// One row = one habit checked in on one calendar day. The UNIQUE (habit_id,
// date) constraint enforces "one check-in per day" at the database boundary.
export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    habitId: uuid("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [unique("uq_checkin_habit_date").on(table.habitId, table.date)]
);

// ── follows ──────────────────────────────────────────────────────────────────
// One-way follow. Composite PK prevents duplicates; the CHECK forbids
// following yourself.
export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followeeId] }),
    check("no_self_follow", sql`${table.followerId} <> ${table.followeeId}`)
  ]
);

// ── Relations (for typed relational queries) ─────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  habits: many(habits),
  following: many(follows, { relationName: "follower" }),
  followers: many(follows, { relationName: "followee" })
}));

export const habitsRelations = relations(habits, ({ one, many }) => ({
  user: one(users, { fields: [habits.userId], references: [users.id] }),
  checkIns: many(checkIns)
}));

export const checkInsRelations = relations(checkIns, ({ one }) => ({
  habit: one(habits, { fields: [checkIns.habitId], references: [habits.id] })
}));

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, {
    fields: [follows.followerId],
    references: [users.id],
    relationName: "follower"
  }),
  followee: one(users, {
    fields: [follows.followeeId],
    references: [users.id],
    relationName: "followee"
  })
}));

// ── Inferred types (single source of truth) ──────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;
export type CheckIn = typeof checkIns.$inferSelect;
export type NewCheckIn = typeof checkIns.$inferInsert;
export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;
