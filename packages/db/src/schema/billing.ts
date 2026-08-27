import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ── payments (L12) ───────────────────────────────────────────────────────────
// Our audit row for a Stripe Payment Intent. We store Stripe *ids* and call
// Stripe when we need details; the webhook is the source of truth for status.
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "canceled"
]);

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** pi_XXX */
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  /** smallest currency unit — 500 = $5.00. Exact integer, never a float. */
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  status: paymentStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

// ── webhook_events (L12, idempotency) ────────────────────────────────────────
// Provider event ids we've already processed. INSERT inside the handler's
// transaction; a unique violation means "seen before → return 200, do nothing".
// Retries can hit as hard as they want.
export const webhookEvents = pgTable("webhook_events", {
  /** provider event id, e.g. evt_1PxYz… */
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow()
});
