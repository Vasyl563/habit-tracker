import { checkIns, type Db, follows, habits, users } from "@habit-tracker/db";
import { and, desc, eq, exists, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { CursorKey } from "../../lib/cursor.js";
import { keysetBefore } from "../check-ins/check-ins.repository.js";

export interface FeedRow {
  id: string;
  date: string;
  note: string | null;
  createdAt: Date;
  habitId: string;
  habitName: string;
  visibility: "public" | "friends" | "private";
  currentStreak: number;
  userId: string;
  userName: string;
  userImage: string | null;
}

export class FeedRepository {
  constructor(private readonly db: Db) {}

  /**
   * The activity feed in ONE query — check-ins of people the viewer follows,
   * with per-habit visibility applied *in SQL* (server-side, on every read):
   *
   *   public  → any follower sees it
   *   friends → only if the owner follows the viewer back (EXISTS subquery)
   *   private → never appears
   *
   * Cursor keyset on (created_at, id) → constant time no matter how deep.
   */
  async list(viewerId: string, cursor: CursorKey | null, limit: number): Promise<FeedRow[]> {
    const followedUsers = this.db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(eq(follows.followerId, viewerId));

    const back = alias(follows, "back");
    const ownerFollowsViewer = exists(
      this.db
        .select({ one: back.followerId })
        .from(back)
        .where(and(eq(back.followerId, habits.userId), eq(back.followeeId, viewerId)))
    );

    return this.db
      .select({
        id: checkIns.id,
        date: checkIns.date,
        note: checkIns.note,
        createdAt: checkIns.createdAt,
        habitId: habits.id,
        habitName: habits.name,
        visibility: habits.visibility,
        currentStreak: habits.currentStreak,
        userId: users.id,
        userName: users.name,
        userImage: users.image
      })
      .from(checkIns)
      .innerJoin(habits, eq(habits.id, checkIns.habitId))
      .innerJoin(users, eq(users.id, habits.userId))
      .where(
        and(
          inArray(habits.userId, followedUsers),
          isNull(habits.archivedAt),
          or(
            eq(habits.visibility, "public"),
            and(eq(habits.visibility, "friends"), ownerFollowsViewer)
          ),
          cursor ? keysetBefore(cursor) : undefined
        )
      )
      .orderBy(desc(checkIns.createdAt), desc(checkIns.id))
      .limit(limit + 1);
  }
}
