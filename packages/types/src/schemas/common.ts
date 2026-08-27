import { z } from "zod";

// ── Primitives reused everywhere ─────────────────────────────────────────────
export const uuidSchema = z.uuid();
/** Calendar day as YYYY-MM-DD (no time, no timezone) — what check-ins are keyed by. */
export const isoDateSchema = z.iso.date();
/** Timestamps cross the wire as ISO-8601 strings; JSON has no Date type. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

// ── Pagination (L8) ──────────────────────────────────────────────────────────
export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

const limitSchema = z.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT);

/**
 * Cursor pagination — for feeds/timelines: constant-time "give me the next N
 * after this opaque token". Stable under inserts; no "go to page 47".
 */
export const cursorQuerySchema = z.object({
  limit: limitSchema,
  cursor: z.string().min(1).optional()
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/**
 * Offset pagination — for catalogues where page numbers are a real product
 * requirement. Slow on deep pages, easy to navigate.
 */
export const offsetQuerySchema = z.object({
  limit: limitSchema,
  offset: z.number().int().min(0).default(0)
});
export type OffsetQuery = z.infer<typeof offsetQuerySchema>;

export const sortDirSchema = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof sortDirSchema>;

/** Generic envelope factories — clients depend on the shape never changing. */
export function cursorPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable()
  });
}
export function offsetPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    limit: z.number().int(),
    offset: z.number().int()
  });
}
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface OffsetPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ── Unified error envelope (L9) ──────────────────────────────────────────────
/**
 * Every error, every endpoint, the same shape.
 *  - code:    machine-readable, UPPER_SNAKE — for branching, retries, i18n keys
 *  - message: for humans, short and actionable
 *  - details: structured extras (Zod issues, conflicting field, retryAfter…)
 */
export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "UNPROCESSABLE",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INTERNAL_ERROR"
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional()
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const okSchema = z.object({ ok: z.literal(true) });
