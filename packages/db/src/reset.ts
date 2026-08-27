import { sql } from "drizzle-orm";
import type { DbOrTx } from "./client.js";
import { db, pool } from "./client.js";

/**
 * Wipe every application table (keeps the schema + migration history).
 * Idempotent — the "clean DB" seed from the L13 Definition of Done.
 * TRUNCATE … CASCADE follows FKs, RESTART IDENTITY resets sequences.
 */
export async function truncateAll(client: DbOrTx = db): Promise<void> {
  await client.execute(sql`
    TRUNCATE TABLE
      webhook_events, payments, files, outbox, notifications,
      verifications, accounts, sessions,
      check_ins, follows, habits, user_settings, users
    RESTART IDENTITY CASCADE
  `);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  truncateAll()
    .then(async () => {
      console.log("🧹 all tables truncated");
      await pool.end();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
