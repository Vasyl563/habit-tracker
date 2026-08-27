import { describe, expect, it } from "vitest";
import { formatMoney, templates } from "./templates.js";

describe("notification templates", () => {
  it("formats money from the smallest unit", () => {
    expect(formatMoney(500, "usd")).toBe("$5.00");
    expect(formatMoney(1999, "eur")).toBe("€19.99");
  });

  it("streak milestone plan carries an email and deep-link data", () => {
    const plan = templates.streakMilestone(
      {
        checkInId: "5b1e0e5a-1c14-4f22-9e6f-3f5b8a1d2c33",
        habitId: "5b1e0e5a-1c14-4f22-9e6f-3f5b8a1d2c34",
        habitName: "Read",
        userId: "5b1e0e5a-1c14-4f22-9e6f-3f5b8a1d2c35",
        date: "2026-06-17",
        streakBefore: 6,
        streakAfter: 7,
        milestone: 7
      },
      "http://web"
    );
    expect(plan.type).toBe("streak.milestone");
    expect(plan.title).toContain("7-day");
    expect(plan.email?.text).toContain("http://web/habits/");
    expect(plan.data).toMatchObject({ milestone: 7 });
  });

  it("file.processed is in-app only (no email)", () => {
    const plan = templates.fileProcessed({
      fileId: "5b1e0e5a-1c14-4f22-9e6f-3f5b8a1d2c33",
      userId: "5b1e0e5a-1c14-4f22-9e6f-3f5b8a1d2c35",
      status: "rejected",
      reason: "not an image"
    });
    expect(plan.type).toBe("file.rejected");
    expect(plan.email).toBeUndefined();
  });
});
