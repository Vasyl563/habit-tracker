import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema/index.js";

// Load the repo-root .env (this file lives in packages/db/src/). Apps validate
// the full env with Zod at boot; here we only need DATABASE_URL.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const { Pool } = pg;

export type Schema = typeof schema;

/** Build a pool + drizzle client for a given URL (tests use a separate DB). */
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/habit_tracker";

const created = createDb(connectionString);

export const pool = created.pool;
/** `schema` is passed so `db.query.*` relational queries are available. */
export const db = created.db;

export type Db = typeof db;
/** The `tx` handed to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Repositories accept either — so a service can run them inside one tx. */
export type DbOrTx = Db | Tx;
