import { describe, expect, it, vi } from "vitest";
import { backoffDelay, isRetriableError, retry, UnrecoverableError } from "./retry.js";

describe("retry", () => {
  it("retries a retriable failure and then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("boom"), { status: 503 });
      return "ok";
    });

    const result = await retry(fn, { retries: 3, baseMs: 1, maxMs: 2 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors (4xx)", async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error("bad request"), { status: 400 });
    });

    await expect(retry(fn, { retries: 3, baseMs: 1 })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after `retries` extra attempts", async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error("down"), { status: 500 });
    });

    await expect(retry(fn, { retries: 2, baseMs: 1, maxMs: 1 })).rejects.toThrow("down");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("treats UnrecoverableError as permanent", () => {
    expect(isRetriableError(new UnrecoverableError("nope"))).toBe(false);
    expect(isRetriableError(Object.assign(new Error(), { status: 429 }))).toBe(true);
    expect(isRetriableError(Object.assign(new Error(), { code: "ECONNRESET" }))).toBe(true);
  });

  it("uses equal jitter: delay is within [expo/2, expo]", () => {
    expect(backoffDelay(0, { baseMs: 200, random: () => 0 })).toBe(100);
    expect(backoffDelay(0, { baseMs: 200, random: () => 1 })).toBe(200);
    expect(backoffDelay(3, { baseMs: 200, maxMs: 1000, random: () => 0.5 })).toBe(750);
    // capped by maxMs
    expect(backoffDelay(10, { baseMs: 200, maxMs: 1000, random: () => 1 })).toBe(1000);
  });
});
