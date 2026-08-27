import { describe, expect, it } from "vitest";
import { computeStripeSignature, verifyStripeSignature } from "./stripe-signature.js";

const secret = "whsec_test_secret";
const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
const now = 1_750_000_000;

const header = (t: number, sig: string) => `t=${t},v1=${sig}`;

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed payload inside the tolerance window", () => {
    const sig = computeStripeSignature(now, body, secret);
    expect(() => verifyStripeSignature(body, header(now, sig), secret, now + 30)).not.toThrow();
  });

  it("rejects a tampered body (signature no longer matches)", () => {
    const sig = computeStripeSignature(now, body, secret);
    const tampered = body.replace("evt_1", "evt_2");
    expect(() => verifyStripeSignature(tampered, header(now, sig), secret, now)).toThrow(/Invalid/);
  });

  it("rejects an old timestamp — replay defence", () => {
    const old = now - 3600;
    const sig = computeStripeSignature(old, body, secret);
    expect(() => verifyStripeSignature(body, header(old, sig), secret, now)).toThrow(/tolerance/);
  });

  it("rejects a missing or malformed header", () => {
    expect(() => verifyStripeSignature(body, undefined, secret, now)).toThrow(/Missing/);
    expect(() => verifyStripeSignature(body, "garbage", secret, now)).toThrow(/Malformed/);
  });
});
