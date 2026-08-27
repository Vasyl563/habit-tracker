import { describe, expect, it } from "vitest";
import { computeStreaks, crossedMilestone } from "./streaks.js";

const daily = { schedule: "daily" as const, weekdays: null };

describe("computeStreaks · daily", () => {
  it("counts consecutive days ending today", () => {
    const s = computeStreaks(["2026-06-15", "2026-06-16", "2026-06-17"], daily, "2026-06-17");
    expect(s).toEqual({ current: 3, longest: 3 });
  });

  it("keeps the streak alive when today is not checked yet (grace)", () => {
    const s = computeStreaks(["2026-06-15", "2026-06-16"], daily, "2026-06-17");
    expect(s.current).toBe(2);
  });

  it("breaks the streak after a missed day", () => {
    const s = computeStreaks(["2026-06-13", "2026-06-14", "2026-06-16"], daily, "2026-06-16");
    expect(s).toEqual({ current: 1, longest: 2 });
  });

  it("returns zeros with no check-ins", () => {
    expect(computeStreaks([], daily, "2026-06-16")).toEqual({ current: 0, longest: 0 });
  });

  it("current is 0 when the last check-in is two days old", () => {
    const s = computeStreaks(["2026-06-10", "2026-06-11"], daily, "2026-06-13");
    expect(s).toEqual({ current: 0, longest: 2 });
  });
});

describe("computeStreaks · weekly", () => {
  // Mon/Wed/Fri habit. 2026-06-15 is a Monday.
  const mwf = { schedule: "weekly" as const, weekdays: [1, 3, 5] };

  it("ignores unscheduled days", () => {
    // Mon 15, Wed 17, Fri 19 checked; today Sat 20 (unscheduled)
    const s = computeStreaks(["2026-06-15", "2026-06-17", "2026-06-19"], mwf, "2026-06-20");
    expect(s).toEqual({ current: 3, longest: 3 });
  });

  it("breaks when a scheduled day is skipped", () => {
    // Mon 15 ✓, Wed 17 ✗, Fri 19 ✓ ; today Fri 19
    const s = computeStreaks(["2026-06-15", "2026-06-19"], mwf, "2026-06-19");
    expect(s).toEqual({ current: 1, longest: 1 });
  });
});

describe("crossedMilestone", () => {
  it("detects the first milestone crossed", () => {
    expect(crossedMilestone(6, 7)).toBe(7);
    expect(crossedMilestone(2, 3)).toBe(3);
    expect(crossedMilestone(7, 8)).toBeNull();
    expect(crossedMilestone(0, 1)).toBeNull();
  });
});
