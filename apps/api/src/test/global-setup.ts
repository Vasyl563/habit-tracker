import { prepareTestDatabase } from "@habit-tracker/db/test-utils";
import { testEnvSource } from "./test-env.js";

/** Runs once before the integration project: create + migrate the test DB. */
export default async function globalSetup() {
  const env = testEnvSource();
  const { pool } = await prepareTestDatabase(env.TEST_DATABASE_URL);
  await pool.end();
}
