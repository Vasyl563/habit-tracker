import { type Db, type DbOrTx, type FileRow, files, type NewFileRow } from "@habit-tracker/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { CursorKey } from "../../lib/cursor.js";
import { mapDbError } from "../../lib/errors.js";

export class FilesRepository {
  constructor(private readonly db: Db) {}

  findById(id: string, tx: DbOrTx = this.db): Promise<FileRow | null> {
    return tx.query.files.findFirst({ where: eq(files.id, id) }).then((r) => r ?? null);
  }

  async create(data: NewFileRow): Promise<FileRow> {
    try {
      const [row] = await this.db.insert(files).values(data).returning();
      if (!row) throw new Error("insert returned no row");
      return row;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async update(id: string, patch: Partial<NewFileRow>): Promise<FileRow> {
    const [row] = await this.db.update(files).set(patch).where(eq(files.id, id)).returning();
    if (!row) throw new Error(`file ${id} vanished during update`);
    return row;
  }

  list(
    userId: string,
    opts: { kind?: "avatar" | "checkin_photo"; limit: number; cursor: CursorKey | null }
  ): Promise<FileRow[]> {
    return this.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          opts.kind ? eq(files.kind, opts.kind) : undefined,
          opts.cursor
            ? or(
                lt(files.createdAt, opts.cursor.createdAt),
                and(eq(files.createdAt, opts.cursor.createdAt), lt(files.id, opts.cursor.id))
              )
            : undefined
        )
      )
      .orderBy(desc(files.createdAt), desc(files.id))
      .limit(opts.limit + 1);
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.db.delete(files).where(eq(files.id, id)).returning({ id: files.id });
    return rows.length > 0;
  }
}
