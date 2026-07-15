import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.js";

// Load the repo-root .env (this file lives in packages/db/src/).
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5433/habit_tracker";

export const pool = new Pool({ connectionString });

// `schema` is passed so `db.query.*` relational queries are available.
export const db = drizzle(pool, { schema });
