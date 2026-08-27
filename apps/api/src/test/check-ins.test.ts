import { outbox } from "@habit-tracker/db";
import { addDays, todayIso } from "@habit-tracker/shared";
import type { CheckInDto, CheckInResultDto, CursorPage, HabitDto } from "@habit-tracker/types";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, type Session, signUp, type TestApp } from "./helpers.js";

/**
 * The atomic check-in (course NFR): one row per day (409 from the UNIQUE
 * constraint), streaks recomputed in the same transaction, safe under
 * concurrent requests, outbox event written, undo recomputes again.
 */
describe("check-ins", () => {
  let t: TestApp;
  let me: Session;
  let habit: HabitDto;
  const today = todayIso();

  beforeAll(async () => {
    t = await createTestApp();
    await t.reset();
    me = await signUp(t.app, "Streak Runner");
    const res = await api<HabitDto>(t.app, "POST", "/v1/habits", {
      session: me,
      body: { name: "Meditate", schedule: "daily", visibility: "public" }
    });
    habit = res.body;
  });
  afterAll(() => t?.close());

  it("checks in today → 201 with streak 1, then 409 on the same day", async () => {
    const first = await api<CheckInResultDto>(t.app, "POST", `/v1/habits/${habit.id}/check-ins`, {
      session: me,
      body: { note: "day one" }
    });
    expect(first.status).toBe(201);
    expect(first.body.checkIn.date).toBe(today);
    expect(first.body.streak).toEqual({ current: 1, longest: 1, milestone: null });

    const dup = await api<{ code: string }>(t.app, "POST", `/v1/habits/${habit.id}/check-ins`, {
      session: me,
      body: {}
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("CONFLICT");
  });

  it("backfilling yesterday and the day before grows the streak to 3 and crosses the 3-day milestone", async () => {
    await api(t.app, "POST", `/v1/habits/${habit.id}/check-ins`, {
      session: me,
      body: { date: addDays(today, -1) }
    });
    const res = await api<CheckInResultDto>(t.app, "POST", `/v1/habits/${habit.id}/check-ins`, {
      session: me,
      body: { date: addDays(today, -2) }
    });
    expect(res.status).toBe(201);
    expect(res.body.streak.current).toBe(3);
    expect(res.body.streak.longest).toBe(3);
    expect(res.body.streak.milestone).toBe(3);

    // denormalised counters on the habit agree with the check-ins
    const h = await api<HabitDto>(t.app, "GET", `/v1/habits/${habit.id}`, { session: me });
    expect(h.body).toMatchObject({
      currentStreak: 3,
      longestStreak: 3,
      totalCheckIns: 3,
      lastCheckInDate: today
    });
  });

  it("wrote a checkin.created event to the outbox in the same transaction", async () => {
    const rows = await t.container.db.select().from(outbox).where(eq(outbox.aggregateId, habit.id));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.eventType === "checkin.created")).toBe(true);
    expect(rows.some((r) => (r.payload as { milestone: number | null }).milestone === 3)).toBe(
      true
    );
  });

  it("rejects future dates (422) and other people's habits (403)", async () => {
    const future = await api<{ code: string }>(t.app, "POST", `/v1/habits/${habit.id}/check-ins`, {
      session: me,
      body: { date: addDays(today, 1) }
    });
    expect(future.status).toBe(422);

    const stranger = await signUp(t.app, "Stranger");
    const forbidden = await api(t.app, "POST", `/v1/habits/${habit.id}/check-ins`, {
      session: stranger,
      body: {}
    });
    expect(forbidden.status).toBe(403);
  });

  it("is race-safe: 5 concurrent check-ins for the same day → exactly one 201, four 409", async () => {
    const other = await api<HabitDto>(t.app, "POST", "/v1/habits", {
      session: me,
      body: { name: "Race", schedule: "daily" }
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(t.app, "POST", `/v1/habits/${other.body.id}/check-ins`, { session: me, body: {} })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    const h = await api<HabitDto>(t.app, "GET", `/v1/habits/${other.body.id}`, { session: me });
    expect(h.body.totalCheckIns).toBe(1); // never double-counted
    expect(h.body.currentStreak).toBe(1);
  });

  it("undo recomputes the streak", async () => {
    const del = await api(t.app, "DELETE", `/v1/habits/${habit.id}/check-ins/${today}`, {
      session: me
    });
    expect(del.status).toBe(200);
    const h = await api<HabitDto>(t.app, "GET", `/v1/habits/${habit.id}`, { session: me });
    // yesterday + day-before still there → current streak 2 (today is in grace), total 2
    expect(h.body).toMatchObject({ currentStreak: 2, totalCheckIns: 2 });
    const again = await api(t.app, "DELETE", `/v1/habits/${habit.id}/check-ins/${today}`, {
      session: me
    });
    expect(again.status).toBe(404);
  });

  it("lists check-ins with cursor pagination", async () => {
    const page1 = await api<CursorPage<CheckInDto>>(
      t.app,
      "GET",
      `/v1/habits/${habit.id}/check-ins?limit=1`,
      {
        session: me
      }
    );
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await api<CursorPage<CheckInDto>>(
      t.app,
      "GET",
      `/v1/habits/${habit.id}/check-ins?limit=1&cursor=${page1.body.nextCursor}`,
      { session: me }
    );
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0]?.id).not.toBe(page1.body.items[0]?.id);
  });
});
