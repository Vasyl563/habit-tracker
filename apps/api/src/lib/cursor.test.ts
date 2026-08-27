import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, toCursorPage } from "./cursor.js";

describe("cursor", () => {
  it("round-trips createdAt + id", () => {
    const key = {
      createdAt: new Date("2026-06-17T10:00:00.000Z"),
      id: "5b1e0e5a-1c14-4f22-9e6f-3f5b8a1d2c33"
    };
    const decoded = decodeCursor(encodeCursor(key));
    expect(decoded?.id).toBe(key.id);
    expect(decoded?.createdAt.toISOString()).toBe(key.createdAt.toISOString());
  });

  it("rejects garbage cursors with a 400", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrowError(/Invalid cursor/);
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("uses limit+1 to know whether a next page exists", () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      createdAt: new Date(2026, 0, i + 1),
      id: `00000000-0000-4000-8000-00000000000${i}`
    }));
    const page = toCursorPage(rows, 2);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect(toCursorPage(rows, 3).nextCursor).toBeNull();
  });
});
