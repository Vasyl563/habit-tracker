import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, type TestApp } from "./helpers.js";

/** Rate limiting (L9), health (L13), correlation id (L9), 404 envelope. */
describe("reliability", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await t.reset();
  });
  afterAll(() => t?.close());

  it("sliding-window rate limit on sign-in: 429 with Retry-After after 10 attempts", async () => {
    const attempt = () =>
      api<{ code?: string }>(t.app, "POST", "/api/auth/sign-in/email", {
        body: { email: "nobody@test.local", password: "wrong-password" },
        headers: { "x-forwarded-for": "203.0.113.7" }
      });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    const last = await attempt();
    expect(last.status).toBe(429);
    expect(last.body.code).toBe("RATE_LIMITED");
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("/health reports dependency checks", async () => {
    const res = await api<{ ok: boolean; checks: Record<string, string> }>(t.app, "GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ postgres: "ok", redis: "ok" });
  });

  it("echoes / mints an x-request-id on every response", async () => {
    const minted = await api(t.app, "GET", "/health");
    expect(minted.headers.get("x-request-id")).toMatch(/[0-9a-f-]{36}/);
    const echoed = await api(t.app, "GET", "/health", { headers: { "x-request-id": "trace-123" } });
    expect(echoed.headers.get("x-request-id")).toBe("trace-123");
  });

  it("unknown routes get the same error envelope", async () => {
    const res = await api<{ code: string }>(t.app, "GET", "/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("serves the generated OpenAPI spec and docs", async () => {
    const spec = await api<{ paths: Record<string, unknown> }>(t.app, "GET", "/v1/openapi.json");
    expect(spec.status).toBe(200);
    expect(Object.keys(spec.body.paths).length).toBeGreaterThanOrEqual(20);
    const docs = await t.app.request("/v1/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
  });
});
