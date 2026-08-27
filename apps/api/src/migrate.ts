import { fileURLToPath } from "node:url";
import { runMigrations } from "@habit-tracker/db/migrate";
import { parseEnv } from "@habit-tracker/shared";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Migration entrypoint for deploys (L13): run as a separate job/step BEFORE
 * the new api image goes live. Fails loudly → the deploy stops → nothing new
 * runs on a broken schema. Guarded by a Postgres advisory lock so two
 * concurrent deploys cannot race.
 *
 *   pnpm --filter @habit-tracker/api migrate
 */
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const env = parseEnv(z.object({ DATABASE_URL: z.url() }));

try {
  await runMigrations(env.DATABASE_URL);
  console.log("✅ migrations applied");
  process.exit(0);
} catch (error) {
  console.error("❌ migration failed", error);
  process.exit(1);
}
