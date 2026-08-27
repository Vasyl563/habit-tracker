import type { HabitDto, OffsetPage } from "@habit-tracker/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, type Session, signUp, type TestApp } from "./helpers.js";

/**
 * Habits module through the real HTTP surface (/v1 = OpenAPI handler):
 * auth guard, Zod validation envelope, CRUD, ownership, list filters + sort
 * whitelist + offset pagination, and cache invalidation on write.
 */
describe("habits", () => {
  let t: TestApp;
  let me: Session;
  let other: Session;

  beforeAll(async () => {
    t = await createTestApp();
    await t.reset();
    me = await signUp(t.app, "Habit Owner");
    other = await signUp(t.app, "Some One Else");
  });
  afterAll(() => t?.close());

  it("rejects anonymous callers with the unified 401 envelope", async () => {
    const res = await api(t.app, "GET", "/v1/habits");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: "UNAUTHORIZED", message: "Authentication required" });
  });

  it("validates input at the edge — Zod issues become `details`", async () => {
    const res = await api<{ code: string; details: { path: string[] }[] }>(
      t.app,
      "POST",
      "/v1/habits",
      {
        session: me,
        body: { name: "", schedule: "weekly" }
      }
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    const paths = res.body.details.map((d) => d.path.join("."));
    expect(paths).toContain("name");
    expect(paths).toContain("weekdays"); // cross-field refine
  });

  it("creates, reads, updates and archives a habit (201 / 200)", async () => {
    const created = await api<HabitDto>(t.app, "POST", "/v1/habits", {
      session: me,
      body: { name: "Morning run", schedule: "weekly", weekdays: [1, 3, 5], visibility: "public" }
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Morning run",
      weekdays: [1, 3, 5],
      currentStreak: 0
    });
    // DTO discipline: no DB-only columns leak
    expect(created.body).not.toHaveProperty("email");

    const got = await api<HabitDto>(t.app, "GET", `/v1/habits/${created.body.id}`, { session: me });
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(created.body.id);

    const updated = await api<HabitDto>(t.app, "PATCH", `/v1/habits/${created.body.id}`, {
      session: me,
      body: { name: "Evening run", schedule: "daily" }
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: "Evening run", schedule: "daily", weekdays: null });

    const archived = await api<HabitDto>(t.app, "POST", `/v1/habits/${created.body.id}/archive`, {
      session: me
    });
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).not.toBeNull();
  });

  it("enforces ownership: 403 on someone else's habit for writes, 404 for private reads", async () => {
    const mine = await api<HabitDto>(t.app, "POST", "/v1/habits", {
      session: me,
      body: { name: "Secret diary", visibility: "private" }
    });
    const write = await api(t.app, "PATCH", `/v1/habits/${mine.body.id}`, {
      session: other,
      body: { name: "hacked" }
    });
    expect(write.status).toBe(403);
    // privacy-safe: a private habit is a 404 for outsiders, not a 403
    const read = await api(t.app, "GET", `/v1/habits/${mine.body.id}`, { session: other });
    expect(read.status).toBe(404);
    // public habits are readable by anyone signed in
    const pub = await api<HabitDto>(t.app, "POST", "/v1/habits", {
      session: me,
      body: { name: "Public habit", visibility: "public" }
    });
    const readPub = await api(t.app, "GET", `/v1/habits/${pub.body.id}`, { session: other });
    expect(readPub.status).toBe(200);
  });

  it("lists with offset pagination, filters and a whitelisted sort", async () => {
    const list = await api<OffsetPage<HabitDto>>(
      t.app,
      "GET",
      "/v1/habits?limit=2&offset=0&sortBy=name&sortDir=asc&includeArchived=true",
      { session: me }
    );
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeLessThanOrEqual(2);
    expect(list.body.total).toBeGreaterThanOrEqual(3);
    const names = list.body.items.map((h) => h.name);
    expect(names).toEqual([...names].sort());

    const filtered = await api<OffsetPage<HabitDto>>(
      t.app,
      "GET",
      "/v1/habits?visibility=private",
      { session: me }
    );
    expect(filtered.body.items.every((h) => h.visibility === "private")).toBe(true);

    const search = await api<OffsetPage<HabitDto>>(t.app, "GET", "/v1/habits?q=public", {
      session: me
    });
    expect(search.body.items.map((h) => h.name)).toContain("Public habit");

    // sortBy is a whitelist — anything else is a 400, never an ORDER BY injection
    const bad = await api<{ code: string }>(t.app, "GET", "/v1/habits?sortBy=password", {
      session: me
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_ERROR");
  });

  it("invalidates the cached list on write (version bump)", async () => {
    const before = await api<OffsetPage<HabitDto>>(
      t.app,
      "GET",
      "/v1/habits?includeArchived=true",
      { session: me }
    );
    await api(t.app, "POST", "/v1/habits", { session: me, body: { name: "Brand new" } });
    const after = await api<OffsetPage<HabitDto>>(t.app, "GET", "/v1/habits?includeArchived=true", {
      session: me
    });
    expect(after.body.total).toBe(before.body.total + 1);
    expect(after.body.items.map((h) => h.name)).toContain("Brand new");
  });

  it("deletes a habit and answers 404 afterwards", async () => {
    const h = await api<HabitDto>(t.app, "POST", "/v1/habits", {
      session: me,
      body: { name: "Temp" }
    });
    const del = await api(t.app, "DELETE", `/v1/habits/${h.body.id}`, { session: me });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
    const gone = await api(t.app, "GET", `/v1/habits/${h.body.id}`, { session: me });
    expect(gone.status).toBe(404);
  });
});
