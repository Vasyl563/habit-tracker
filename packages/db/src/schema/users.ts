import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const userPlan = pgEnum("user_plan", ["free", "pro"]);

// ── users ────────────────────────────────────────────────────────────────────
// Account row. `email_verified` + `image` are what better-auth (L10) expects
// on its `user` model; `plan` is flipped by the Stripe webhook (L12).
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  bio: text("bio"),
  image: text("image"),
  emailVerified: boolean("email_verified").notNull().default(false),
  plan: userPlan("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

// ── user_settings (1:1) ──────────────────────────────────────────────────────
// A 1:1 table: PK *is* the FK. Kept apart from `users` so auth code (which
// reads users on every request) never drags preferences along.
export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  weeklyDigest: boolean("weekly_digest").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});
