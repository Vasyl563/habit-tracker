import { ORPCError } from "@orpc/client";

/**
 * ONE error renderer for the whole UI (L9): every API error has the same
 * `{ code, message, details }` shape, so we branch on `code`, never parse
 * status text.
 */
export function describeError(error: unknown): string {
  if (error instanceof ORPCError) {
    if (error.code === "VALIDATION_ERROR" && Array.isArray(error.data)) {
      const issues = error.data as { path: (string | number)[]; message: string }[];
      return issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join(" · ");
    }
    if (error.code === "RATE_LIMITED")
      return "Too many requests — take a breath and retry in a minute.";
    return error.message || error.code;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
