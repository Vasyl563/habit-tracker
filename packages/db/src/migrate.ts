import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

/**
 * Programmatic migrator (L13: "migrate before deploy, guarded by an advisory
 * lock"). Used by:
 *   - the CI migrate job / container entrypoint  →  `tsx src/migrate.ts`
 *   - integration tests (fresh DB → run every migration)
 *
 * `pg_advisory_lock` serialises concurrent deploys: two replicas racing to
 * migrate the same DB — the first wins, the second waits, then finds nothing
 * to do. drizzle's migrator itself is idempotent (tracks __drizzle_migrations).
 */
const MIGRATION_LOCK_ID = 7_355_608; // arbitrary, app-wide constant

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString);
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  try {
    await db.execute(sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`);
    try {
      await migrate(db, { migrationsFolder });
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`);
    }
  } finally {
    await pool.end();
  }
}

// CLI entry: `tsx src/migrate.ts` (DATABASE_URL from env / .env)
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log("✅ migrations applied");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
