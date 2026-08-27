import { type Db, type DbOrTx, follows, users } from "@habit-tracker/db";
import { type AnyColumn, and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { mapDbError } from "../../lib/errors.js";

/** drizzle's inArray throws on an empty list; keep the guard in one place. */
function inArrayOrFalse(column: AnyColumn, values: string[]) {
  return values.length === 0 ? sql`false` : inArray(column, values);
}

export class FollowsRepository {
  constructor(private readonly db: Db) {}

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const row = await this.db.query.follows.findFirst({
      where: and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId))
    });
    return Boolean(row);
  }

  /** "friends" = mutual follow: both directions exist. */
  async isMutual(a: string, b: string): Promise<boolean> {
    const rows = await this.db
      .select({ followerId: follows.followerId })
      .from(follows)
      .where(
        or(
          and(eq(follows.followerId, a), eq(follows.followeeId, b)),
          and(eq(follows.followerId, b), eq(follows.followeeId, a))
        )
      );
    return rows.length === 2;
  }

  /** Composite PK makes duplicates a unique violation → ConflictError. */
  async create(followerId: string, followeeId: string, tx: DbOrTx = this.db): Promise<void> {
    try {
      await tx.insert(follows).values({ followerId, followeeId });
    } catch (error) {
      throw mapDbError(error, { unique: "Already following this user", fk: "User does not exist" });
    }
  }

  async remove(followerId: string, followeeId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
      .returning({ followerId: follows.followerId });
    return deleted.length > 0;
  }

  /** Users who follow `userId` (JOIN follows → users), newest first. */
  async listFollowers(userId: string, limit: number, offset: number) {
    const [items, [total]] = await Promise.all([
      this.db
        .select({ user: users })
        .from(follows)
        .innerJoin(users, eq(users.id, follows.followerId))
        .where(eq(follows.followeeId, userId))
        .orderBy(desc(follows.createdAt), follows.followerId)
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(follows).where(eq(follows.followeeId, userId))
    ]);
    return { items: items.map((r) => r.user), total: Number(total?.value ?? 0) };
  }

  /** Users that `userId` follows. */
  async listFollowing(userId: string, limit: number, offset: number) {
    const [items, [total]] = await Promise.all([
      this.db
        .select({ user: users })
        .from(follows)
        .innerJoin(users, eq(users.id, follows.followeeId))
        .where(eq(follows.followerId, userId))
        .orderBy(desc(follows.createdAt), follows.followeeId)
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(follows).where(eq(follows.followerId, userId))
    ]);
    return { items: items.map((r) => r.user), total: Number(total?.value ?? 0) };
  }

  /** ids of everyone `userId` follows — the feed's audience. */
  async followeeIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(eq(follows.followerId, userId));
    return rows.map((r) => r.id);
  }

  /** among `candidateIds`, who follows `userId` back (mutual = "friends") */
  async mutualAmong(userId: string, candidateIds: string[]): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followeeId, userId), inArrayOrFalse(follows.followerId, candidateIds)));
    return new Set(rows.map((r) => r.id));
  }
}
