import { defineConfig } from "vitest/config";

/**
 * Two projects:
 *  - unit        → pure functions, no infra (cursor, signatures, mappers)
 *  - integration → real Postgres + Redis (docker compose / CI services),
 *                  drives the Hono app in-process via app.request()
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/test/**"]
        }
      },
      {
        test: {
          name: "integration",
          include: ["src/test/**/*.test.ts"],
          globalSetup: ["src/test/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // tests share one database → run files one at a time
          fileParallelism: false
        }
      }
    ]
  }
});
