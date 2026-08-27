import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ── files (L12) ──────────────────────────────────────────────────────────────
// Metadata only — the bytes live in object storage (MinIO / S3) under `key`.
// The API never sees the file body: presigned PUT from the browser, ack, then
// a worker validates magic bytes and produces a thumbnail.
export const fileKind = pgEnum("file_kind", ["avatar", "checkin_photo"]);
export const fileStatus = pgEnum("file_status", ["pending", "uploaded", "ready", "rejected"]);

export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: fileKind("kind").notNull(),
    status: fileStatus("status").notNull().default("pending"),
    /** object key, e.g. users/<uid>/avatar/<fileId>.jpg — flat, not a path */
    key: text("key").notNull().unique(),
    thumbnailKey: text("thumbnail_key"),
    originalName: text("original_name").notNull(),
    /** what the client *claimed*; the worker verifies via magic bytes */
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    rejectReason: text("reject_reason"),
    // ms precision: keyset-cursor key (see check_ins)
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [index("idx_files_user_created").on(table.userId, table.createdAt, table.id)]
);
