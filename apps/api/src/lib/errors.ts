import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "@habit-tracker/db";
import type { ErrorCode } from "@habit-tracker/types";

/**
 * Error taxonomy (L9). Three layers, each adds meaning:
 *
 *   AppError            — "something we can name" (code)
 *   └─ HttpException    — "…and here's the HTTP status + safe details"
 *      └─ NotFoundError / ConflictError / …  — the six kinds services throw
 *
 * Services throw these; controllers never try/catch; ONE global handler
 * converts them into the unified `{ code, message, details }` envelope.
 * Anything that is *not* an HttpException is a programmer error → logged
 * loudly, returned as a generic 500, nothing internal leaks.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class HttpException extends AppError {
  constructor(
    public readonly status: number,
    code: ErrorCode | string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message, code);
  }

  /** What the client sees. Never the stack, never SQL, never paths. */
  toResponse(): { code: string; message: string; details?: unknown } {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/** 400 — request body/query didn't match the contract (Zod). */
export class ValidationError extends HttpException {
  constructor(message = "Invalid input", details?: unknown) {
    super(400, "VALIDATION_ERROR", message, details);
  }
}
/** 401 — no (or invalid) credentials. Log in first. */
export class UnauthorizedError extends HttpException {
  constructor(message = "Authentication required") {
    super(401, "UNAUTHORIZED", message);
  }
}
/** 403 — authenticated, but not allowed to do *this*. */
export class ForbiddenError extends HttpException {
  constructor(message = "You are not allowed to do that") {
    super(403, "FORBIDDEN", message);
  }
}
/** 404 — doesn't exist, or (privacy-safe) isn't visible to this caller. */
export class NotFoundError extends HttpException {
  constructor(resource = "Resource", details?: unknown) {
    super(404, "NOT_FOUND", `${resource} not found`, details);
  }
}
/** 409 — collides with current state: duplicate, version mismatch, race. */
export class ConflictError extends HttpException {
  constructor(message = "Conflict with current state", details?: unknown) {
    super(409, "CONFLICT", message, details);
  }
}
/** 422 — well-formed but semantically wrong (business rule). */
export class UnprocessableError extends HttpException {
  constructor(message = "Cannot process this request", details?: unknown) {
    super(422, "UNPROCESSABLE", message, details);
  }
}
/** 429 — too many requests; carries how long to wait. */
export class RateLimitError extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super(429, "RATE_LIMITED", "Too many requests, slow down", { retryAfterSeconds });
  }
}
/** 413 — upload bigger than the cap. */
export class PayloadTooLargeError extends HttpException {
  constructor(maxBytes: number) {
    super(413, "PAYLOAD_TOO_LARGE", `File exceeds the ${maxBytes} byte limit`, { maxBytes });
  }
}
/** 415 — content type we don't accept. */
export class UnsupportedMediaTypeError extends HttpException {
  constructor(contentType: string, allowed: readonly string[]) {
    super(415, "UNSUPPORTED_MEDIA_TYPE", `Unsupported content type ${contentType}`, { allowed });
  }
}
/** 500 — we don't know what happened. Generic on the wire, detailed in logs. */
export class InternalError extends HttpException {
  constructor(message = "Something went wrong") {
    super(500, "INTERNAL_ERROR", message);
  }
}

export function isHttpException(error: unknown): error is HttpException {
  return error instanceof HttpException;
}

/**
 * Repository-level mapping of Postgres constraint failures (L9). The repo
 * never invents domain meaning — it only translates SQLSTATE into a typed
 * error; the *service* decides what a conflict means for the caller.
 */
export function mapDbError(error: unknown, hints: { unique?: string; fk?: string } = {}): unknown {
  if (isUniqueViolation(error)) return new ConflictError(hints.unique ?? "Already exists");
  if (isForeignKeyViolation(error))
    return new ValidationError(hints.fk ?? "Referenced resource does not exist");
  if (isCheckViolation(error)) return new ValidationError("Violates a data constraint");
  return error;
}
