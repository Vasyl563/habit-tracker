/**
 * Postgres reports constraint failures with SQLSTATE codes. The repository
 * layer maps them (L9): unique → ConflictError, FK / CHECK → ValidationError.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_CHECK_VIOLATION = "23514";

interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/** drizzle wraps the driver error as `cause`; walk down to find the SQLSTATE. */
export function getPgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const e = current as PgLikeError;
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    current = e.cause;
  }
  return undefined;
}

export function getPgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const e = current as PgLikeError;
    if (typeof e.constraint === "string") return e.constraint;
    current = e.cause;
  }
  return undefined;
}

export const isUniqueViolation = (e: unknown, constraint?: string): boolean =>
  getPgErrorCode(e) === PG_UNIQUE_VIOLATION && (!constraint || getPgConstraint(e) === constraint);
export const isForeignKeyViolation = (e: unknown): boolean =>
  getPgErrorCode(e) === PG_FOREIGN_KEY_VIOLATION;
export const isCheckViolation = (e: unknown): boolean => getPgErrorCode(e) === PG_CHECK_VIOLATION;
