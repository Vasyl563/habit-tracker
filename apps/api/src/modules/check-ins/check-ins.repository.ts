import { type CheckIn, checkIns, type Db, type DbOrTx, type NewCheckIn } from "@habit-tracker/db";
import { and, desc, eq, gte, lt, lte, or, type SQL, sql } from "drizzle-orm";
import type { CursorKey } from "../../lib/cursor.js";
import { mapDbError } from "../../lib/errors.js";

export class CheckInsRepository {
  constructor(private readonly db: Db) {}

  /** every date this habit was checked — input for the streak function */
  async listDates(habitId: string, tx: DbOrTx = this.db): Promise<string[]> {
    const rows = await tx
      .select({ date: checkIns.date })
      .from(checkIns)
      .where(eq(checkIns.habitId, habitId))
      .orderBy(checkIns.date);
    return rows.map((r) => r.date);
  }

  /** UNIQUE (habit_id, date) → the DB refuses the second check-in of a day. */
  async create(data: NewCheckIn, tx: DbOrTx = this.db): Promise<CheckIn> {
    try {
      const [row] = await tx.insert(checkIns).values(data).returning();
      if (!row) throw new Error("insert returned no row");
      return row;
    } catch (error) {
      throw mapDbError(error, {
        unique: "Already checked in for this date",
        fk: "Habit or photo does not exist"
      });
    }
  }

  async remove(habitId: string, date: string, tx: DbOrTx = this.db): Promise<boolean> {
    const rows = await tx
      .delete(checkIns)
      .where(and(eq(checkIns.habitId, habitId), eq(checkIns.date, date)))
      .returning({ id: checkIns.id });
    return rows.length > 0;
  }

  /**
   * Keyset pagination: ORDER BY created_at DESC, id DESC and
   * WHERE (created_at, id) < (cursor) — an index seek, constant time at any depth.
   */
  async listForHabit(
    habitId: string,
    opts: { from?: string; to?: string; limit: number; cursor: CursorKey | null }
  ): Promise<CheckIn[]> {
    const clauses: (SQL | undefined)[] = [
      eq(checkIns.habitId, habitId),
      opts.from ? gte(checkIns.date, opts.from) : undefined,
      opts.to ? lte(checkIns.date, opts.to) : undefined,
      opts.cursor ? keysetBefore(opts.cursor) : undefined
    ];
    return this.db
      .select()
      .from(checkIns)
      .where(and(...clauses))
      .orderBy(desc(checkIns.createdAt), desc(checkIns.id))
      .limit(opts.limit + 1); // +1 → do we have a next page?
  }
}

/** (created_at, id) < (t, i) — expressed so Postgres can use the composite index */
export function keysetBefore(cursor: CursorKey) {
  return or(
    lt(checkIns.createdAt, cursor.createdAt),
    and(eq(checkIns.createdAt, cursor.createdAt), lt(checkIns.id, cursor.id))
  );
}

/** for the feed: same predicate but comparable across joins */
export const checkInsCreatedAtId = sql`(${checkIns.createdAt}, ${checkIns.id})`;
