import type { z } from "zod";

/**
 * Parse `process.env` (or any record) with a Zod schema (L8: "read once,
 * validated with a Zod env schema"). On failure prints every problem and
 * exits — a misconfigured service must not start.
 */
export function parseEnv<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  source: NodeJS.ProcessEnv = process.env
): z.output<TSchema> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const lines = result.error.issues.map(
    (issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`
  );
  console.error(`❌ Invalid environment variables:\n${lines.join("\n")}`);
  process.exit(1);
}
