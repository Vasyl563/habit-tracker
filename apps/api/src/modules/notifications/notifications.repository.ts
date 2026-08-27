import { type Db, type Notification, notifications } from "@habit-tracker/db";
import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { CursorKey } from "../../lib/cursor.js";

export class NotificationsRepository {
  constructor(private readonly db: Db) {}

  list(
    userId: string,
    opts: { unreadOnly: boolean; limit: number; cursor: CursorKey | null }
  ): Promise<Notification[]> {
    return this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          opts.unreadOnly ? isNull(notifications.readAt) : undefined,
          opts.cursor
            ? or(
                lt(notifications.createdAt, opts.cursor.createdAt),
                and(
                  eq(notifications.createdAt, opts.cursor.createdAt),
                  lt(notifications.id, opts.cursor.id)
                )
              )
            : undefined
        )
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(opts.limit + 1);
  }

  /** hits the partial index idx_notifications_unread */
  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(row?.value ?? 0);
  }

  findById(id: string): Promise<Notification | null> {
    return this.db.query.notifications
      .findFirst({ where: eq(notifications.id, id) })
      .then((r) => r ?? null);
  }

  /** idempotent: already-read rows keep their original read_at */
  async markRead(id: string): Promise<Notification | null> {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), isNull(notifications.readAt)))
      .returning();
    return row ?? (await this.findById(id));
  }

  async markAllRead(userId: string): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
