import { z } from "zod";
import { ValidationError } from "./errors.js";

/**
 * Opaque cursor for keyset pagination (L8). We encode "where you left off"
 * — the sort keys of the last row — as base64url JSON. Clients treat it as
 * a token; the server validates it on the way back in.
 *
 *   ORDER BY created_at DESC, id DESC
 *   WHERE (created_at, id) < (cursor.createdAt, cursor.id)
 *
 * The `id` tiebreaker makes the order total, so rows with equal timestamps
 * are never skipped or repeated. Constant time regardless of depth.
 */
const cursorSchema = z.object({
  t: z.iso.datetime({ offset: true }), // createdAt as ISO string
  i: z.uuid() // id tiebreaker
});
export type CursorKey = { createdAt: Date; id: string };

export function encodeCursor(key: CursorKey): string {
  const json = JSON.stringify({ t: key.createdAt.toISOString(), i: key.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): CursorKey | null {
  if (!cursor) return null;
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
    return { createdAt: new Date(parsed.t), id: parsed.i };
  } catch {
    throw new ValidationError("Invalid cursor", { path: ["cursor"] });
  }
}

/**
 * Fetch limit+1 rows, return `limit` and a cursor built from the last one.
 * The +1 tells us whether a next page exists without a COUNT query.
 */
export function toCursorPage<T extends CursorKey>(
  rows: T[],
  limit: number
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
