import { relations } from "drizzle-orm";
import { accounts, sessions } from "./auth.js";
import { payments } from "./billing.js";
import { files } from "./files.js";
import { checkIns, follows, habits } from "./habits.js";
import { notifications } from "./notifications.js";
import { userSettings, users } from "./users.js";

// Relations live in one file so table files never import each other in a
// cycle. They only power `db.query.*` nested fetches — no SQL is generated
// until you call `with: { ... }`.

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
  habits: many(habits),
  following: many(follows, { relationName: "follower" }),
  followers: many(follows, { relationName: "followee" }),
  sessions: many(sessions),
  accounts: many(accounts),
  notifications: many(notifications),
  files: many(files),
  payments: many(payments)
}));

export const filesRelations = relations(files, ({ one }) => ({
  user: one(users, { fields: [files.userId], references: [users.id] })
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] })
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] })
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] })
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] })
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] })
}));

export const habitsRelations = relations(habits, ({ one, many }) => ({
  user: one(users, { fields: [habits.userId], references: [users.id] }),
  checkIns: many(checkIns)
}));

export const checkInsRelations = relations(checkIns, ({ one }) => ({
  habit: one(habits, { fields: [checkIns.habitId], references: [habits.id] }),
  photo: one(files, { fields: [checkIns.photoFileId], references: [files.id] })
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
