import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

/** Partial-index predicate — drizzle needs raw SQL for `WHERE col IS NULL`. */
const isNull = (column: AnyPgColumn) => sql`${column} IS NULL`;

// ── notifications (L11) ──────────────────────────────────────────────────────
// In-app inbox. `read_at` is a timestamp, not a boolean — you can always
// answer "when did they see it". Rows are never deleted on mark-read.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** the outbox event that produced this row — makes fan-out idempotent */
    eventId: uuid("event_id"),
    /** code, e.g. 'follow.created' — the frontend renders per type */
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** deep-link params, ids — whatever the click destination needs */
    data: jsonb("data").$type<Record<string, unknown>>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    // ms precision: keyset-cursor key (see check_ins)
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow()
  },
  (table) => [
    // list feed: WHERE user_id = ? ORDER BY created_at DESC, id DESC
    index("idx_notifications_user_created").on(table.userId, table.createdAt, table.id),
    // unread badge: WHERE user_id = ? AND read_at IS NULL (partial index)
    index("idx_notifications_unread").on(table.userId).where(isNull(table.readAt)),
    // one notification per (event, recipient) — retries can't duplicate
    uniqueIndex("uq_notifications_event_user").on(table.eventId, table.userId)
  ]
);

// ── outbox (L11, transactional outbox) ───────────────────────────────────────
// Domain events are written here *inside the same transaction* as the
// business change. A poller in the worker moves unpublished rows onto the
// queue. DB commit ⇒ event exists. DB rollback ⇒ event never existed.
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** 'habit' | 'user' | 'payment' | 'file' … */
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    /** 'follow.created' | 'checkin.created' | 'payment.succeeded' … */
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true })
  },
  (table) => [
    // the poller's query: WHERE published_at IS NULL ORDER BY created_at
    index("idx_outbox_unpublished").on(table.createdAt).where(isNull(table.publishedAt))
  ]
);
