import { describe, expect, it } from "vitest";
import { createHabitSchema, listHabitsQuerySchema, updateHabitSchema } from "./habits.js";

describe("habit schemas", () => {
  it("applies defaults (daily, private) and trims the name", () => {
    const parsed = createHabitSchema.parse({ name: "  Read  " });
    expect(parsed).toMatchObject({ name: "Read", schedule: "daily", visibility: "private" });
  });

  it("weekly habits must list weekdays (cross-field refine)", () => {
    const res = createHabitSchema.safeParse({ name: "Run", schedule: "weekly" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.path).toEqual(["weekdays"]);
    expect(
      createHabitSchema.safeParse({ name: "Run", schedule: "weekly", weekdays: [1, 3] }).success
    ).toBe(true);
  });

  it("update is a partial + id", () => {
    expect(updateHabitSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(
      updateHabitSchema.safeParse({ id: "5b1e0e5a-1c14-4f22-9e6f-3f5b8a1d2c33", name: "X" }).success
    ).toBe(true);
  });

  it("list query: limit is capped, sortBy is a whitelist, offset defaults to 0", () => {
    const ok = listHabitsQuerySchema.parse({});
    expect(ok).toMatchObject({ limit: 20, offset: 0, sortBy: "createdAt", sortDir: "desc" });
    expect(listHabitsQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(listHabitsQuerySchema.safeParse({ sortBy: "password" }).success).toBe(false);
  });
});
