import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { truncateAll } from "./reset.js";

/**
 * Helpers for integration tests (apps/api). They talk to a *separate*
 * database (TEST_DATABASE_URL) so `pnpm test:integration` never touches your
 * dev data. The DB is created on demand, migrated, and truncated per suite.
 */
export function getTestDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5433/habit_tracker_test"
  );
}

/** CREATE DATABASE if missing — connects to the maintenance DB `postgres`. */
export async function ensureTestDatabase(url = getTestDatabaseUrl()): Promise<void> {
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, "");
  const admin = new URL(url);
  admin.pathname = "/postgres";

  const { db, pool } = createDb(admin.toString());
  try {
    const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (exists.rowCount === 0) {
      // identifiers can't be parameterised; dbName comes from our own env, not users
      await pool.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    void db;
    await pool.end();
  }
}

export async function prepareTestDatabase(url = getTestDatabaseUrl()) {
  await ensureTestDatabase(url);
  await runMigrations(url);
  const { db, pool } = createDb(url);
  await truncateAll(db);
  return { db, pool, url };
}

export { truncateAll } from "./reset.js";
