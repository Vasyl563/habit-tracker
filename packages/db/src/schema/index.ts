export * from "./auth.js";
export * from "./billing.js";
export * from "./files.js";
export * from "./habits.js";
export * from "./notifications.js";
export * from "./relations.js";
export * from "./users.js";

// ── Inferred entity types (single source of truth) ───────────────────────────
import type { accounts, sessions } from "./auth.js";
import type { payments, webhookEvents } from "./billing.js";
import type { files } from "./files.js";
import type { checkIns, follows, habits } from "./habits.js";
import type { notifications, outbox } from "./notifications.js";
import type { userSettings, users } from "./users.js";

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserSettings = typeof userSettings.$inferSelect;
export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;
export type CheckIn = typeof checkIns.$inferSelect;
export type NewCheckIn = typeof checkIns.$inferInsert;
export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type OutboxEvent = typeof outbox.$inferSelect;
export type NewOutboxEvent = typeof outbox.$inferInsert;
export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
