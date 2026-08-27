import {
  type Db,
  type DbOrTx,
  follows,
  habits,
  type User,
  type UserSettings,
  userSettings,
  users
} from "@habit-tracker/db";
import { and, count, desc, eq, ilike, isNull, max, or, sql, sum } from "drizzle-orm";

/**
 * Repository (L4/L9): knows the data, not the rules. Returns rows or null —
 * the *service* decides whether "null" is a 404 or an empty list. The only
 * errors it throws are DB-constraint translations (unique → Conflict…).
 */
export class UsersRepository {
  constructor(private readonly db: Db) {}

  findById(id: string, tx: DbOrTx = this.db): Promise<User | null> {
    return tx.query.users.findFirst({ where: eq(users.id, id) }).then((r) => r ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.db.query.users.findFirst({ where: eq(users.email, email) }).then((r) => r ?? null);
  }

  findSettings(userId: string): Promise<UserSettings | null> {
    return this.db.query.userSettings
      .findFirst({ where: eq(userSettings.userId, userId) })
      .then((r) => r ?? null);
  }

  async updateProfile(id: string, patch: { name?: string; bio?: string | null }): Promise<User> {
    const [row] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    if (!row) throw new Error(`user ${id} vanished during update`);
    return row;
  }

  /** INSERT … ON CONFLICT DO UPDATE — settings row may not exist yet. */
  async upsertSettings(
    userId: string,
    patch: { timezone?: string; emailNotifications?: boolean; weeklyDigest?: boolean }
  ): Promise<UserSettings> {
    const [row] = await this.db
      .insert(userSettings)
      .values({ userId, ...patch })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...patch, updatedAt: new Date() } })
      .returning();
    if (!row) throw new Error("settings upsert returned no row");
    return row;
  }

  /** ILIKE is enough here (< 100k rows); GIN/tsvector when it isn't (L8). */
  async search(q: string | undefined, limit: number, offset: number) {
    const where = q ? or(ilike(users.name, `%${q}%`), ilike(users.email, `${q}%`)) : undefined;
    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(users.name, users.id)
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(users).where(where)
    ]);
    return { items, total: Number(total?.value ?? 0) };
  }

  /**
   * Profile stats via SQL aggregation — COUNT/SUM/MAX in the database, never
   * loops in application code (course NFR).
   */
  async stats(userId: string) {
    const [habitAgg] = await this.db
      .select({
        habitsTracked: count(),
        totalCheckIns: sum(habits.totalCheckIns),
        longestStreak: max(habits.longestStreak)
      })
      .from(habits)
      .where(and(eq(habits.userId, userId), isNull(habits.archivedAt)));

    const [followerAgg] = await this.db
      .select({ value: count() })
      .from(follows)
      .where(eq(follows.followeeId, userId));
    const [followingAgg] = await this.db
      .select({ value: count() })
      .from(follows)
      .where(eq(follows.followerId, userId));

    const currentStreaks = await this.db
      .select({ habitId: habits.id, habitName: habits.name, currentStreak: habits.currentStreak })
      .from(habits)
      .where(
        and(eq(habits.userId, userId), isNull(habits.archivedAt), sql`${habits.currentStreak} > 0`)
      )
      .orderBy(desc(habits.currentStreak))
      .limit(10);

    return {
      habitsTracked: Number(habitAgg?.habitsTracked ?? 0),
      totalCheckIns: Number(habitAgg?.totalCheckIns ?? 0),
      longestStreak: Number(habitAgg?.longestStreak ?? 0),
      followers: Number(followerAgg?.value ?? 0),
      following: Number(followingAgg?.value ?? 0),
      currentStreaks
    };
  }

  /** Both directions in one query: does viewer follow target, and vice versa. */
  async relationship(viewerId: string, targetId: string) {
    const rows = await this.db
      .select({ followerId: follows.followerId, followeeId: follows.followeeId })
      .from(follows)
      .where(
        or(
          and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)),
          and(eq(follows.followerId, targetId), eq(follows.followeeId, viewerId))
        )
      );
    return {
      isFollowing: rows.some((r) => r.followerId === viewerId),
      isFollowedBy: rows.some((r) => r.followerId === targetId)
    };
  }
}
