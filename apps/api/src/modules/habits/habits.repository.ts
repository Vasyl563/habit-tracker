import { type Db, type DbOrTx, type Habit, habits, type NewHabit } from "@habit-tracker/db";
import type { ListHabitsQuery } from "@habit-tracker/types";
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { mapDbError } from "../../lib/errors.js";

/**
 * Whitelist of sortable columns (L8). User input is a *key* into this map —
 * never a raw string in ORDER BY — so injection is impossible by construction.
 */
const SORT_COLUMNS = {
  createdAt: habits.createdAt,
  name: habits.name,
  currentStreak: habits.currentStreak,
  totalCheckIns: habits.totalCheckIns
} as const;

export class HabitsRepository {
  constructor(private readonly db: Db) {}

  findById(id: string, tx: DbOrTx = this.db): Promise<Habit | null> {
    return tx.query.habits.findFirst({ where: eq(habits.id, id) }).then((r) => r ?? null);
  }

  /**
   * SELECT … FOR UPDATE — locks the habit row until the transaction ends so
   * two concurrent check-ins can't both recompute the streak from stale data.
   */
  async lockForUpdate(id: string, tx: DbOrTx): Promise<Habit | null> {
    const [row] = await tx.select().from(habits).where(eq(habits.id, id)).for("update");
    return row ?? null;
  }

  /**
   * Dynamic filters the safe way: each optional filter becomes a Drizzle
   * clause or `undefined`; `and(...)` skips the undefineds. Drizzle builds
   * parameterised SQL — our job is validating inputs first (Zod did).
   */
  async list(userId: string, q: ListHabitsQuery) {
    const clauses: (SQL | undefined)[] = [
      eq(habits.userId, userId),
      q.includeArchived ? undefined : isNull(habits.archivedAt),
      q.schedule ? eq(habits.schedule, q.schedule) : undefined,
      q.visibility ? eq(habits.visibility, q.visibility) : undefined,
      q.q ? or(ilike(habits.name, `%${q.q}%`), ilike(habits.description, `%${q.q}%`)) : undefined
    ];
    const where = and(...clauses);
    const sortColumn = SORT_COLUMNS[q.sortBy];
    const order = q.sortDir === "asc" ? asc(sortColumn) : desc(sortColumn);

    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(habits)
        .where(where)
        .orderBy(order, asc(habits.id)) // id tiebreaker → stable pages
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ value: count() }).from(habits).where(where)
    ]);
    return { items, total: Number(total?.value ?? 0) };
  }

  async create(data: NewHabit): Promise<Habit> {
    try {
      const [row] = await this.db.insert(habits).values(data).returning();
      if (!row) throw new Error("insert returned no row");
      return row;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async update(id: string, patch: Partial<NewHabit>, tx: DbOrTx = this.db): Promise<Habit> {
    try {
      const [row] = await tx.update(habits).set(patch).where(eq(habits.id, id)).returning();
      if (!row) throw new Error(`habit ${id} vanished during update`);
      return row;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.db.delete(habits).where(eq(habits.id, id)).returning({ id: habits.id });
    return rows.length > 0;
  }

  /** Denormalised counters refreshed inside the check-in transaction (L8). */
  updateCounters(
    id: string,
    counters: {
      currentStreak: number;
      longestStreak: number;
      totalCheckIns: number;
      lastCheckInDate: string | null;
    },
    tx: DbOrTx
  ): Promise<Habit> {
    return this.update(id, counters, tx);
  }

  /** for the "friend checked in" feed filter: habits visible to a viewer */
  visibilityClause(viewerIsFriend: boolean) {
    return viewerIsFriend
      ? sql`${habits.visibility} in ('public', 'friends')`
      : eq(habits.visibility, "public");
  }
}
