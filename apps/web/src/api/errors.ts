import { ORPCError } from "@orpc/client";
import type { Translator } from "../lib/i18n.js";

/**
 * ONE error renderer for the whole UI (L9): every API error has the same
 * `{ code, message, details }` shape, so we branch on `code`, never parse
 * status text. Takes the active translator so the generic texts follow the
 * UI language; server-composed messages are shown as-is.
 */
export function describeError(error: unknown, t: Translator): string {
  if (error instanceof ORPCError) {
    if (error.code === "VALIDATION_ERROR" && Array.isArray(error.data)) {
      const issues = error.data as { path: (string | number)[]; message: string }[];
      return issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join(" · ");
    }
    if (error.code === "RATE_LIMITED") return t("errors.rateLimited");
    return error.message || error.code;
  }
  if (error instanceof Error) return error.message;
  return t("errors.generic");
}
