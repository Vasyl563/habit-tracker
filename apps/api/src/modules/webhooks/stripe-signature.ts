import { createHmac, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "../../lib/errors.js";

/**
 * Stripe's webhook signature scheme, by hand (L12) — the same thing
 * `stripe.webhooks.constructEvent` does, spelled out so it's understandable:
 *
 *   Stripe-Signature: t=<unix seconds>,v1=<hex hmac>[,v1=…]
 *   signed_payload   = `${t}.${rawBody}`
 *   expected         = HMAC-SHA256(secret, signed_payload)
 *
 * Three checks: signature (origin), timestamp within tolerance (recency),
 * and — outside this function — event.id in webhook_events (freshness).
 * `timingSafeEqual` is not optional: a plain `===` leaks how many leading
 * bytes matched through response timing.
 */
export const STRIPE_TOLERANCE_SECONDS = 5 * 60;

export function computeStripeSignature(timestamp: number, rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  now: number = Math.floor(Date.now() / 1000)
): void {
  if (!header) throw new UnauthorizedError("Missing Stripe-Signature header");

  const parts = new Map<string, string[]>();
  for (const kv of header.split(",")) {
    const [k, v] = kv.split("=", 2);
    if (!k || v === undefined) continue;
    parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()]);
  }
  const timestamp = Number(parts.get("t")?.[0]);
  const candidates = parts.get("v1") ?? [];
  if (!Number.isFinite(timestamp) || candidates.length === 0) {
    throw new UnauthorizedError("Malformed Stripe-Signature header");
  }
  if (Math.abs(now - timestamp) > STRIPE_TOLERANCE_SECONDS) {
    throw new UnauthorizedError("Stripe-Signature timestamp outside tolerance (replay?)");
  }

  const expected = Buffer.from(computeStripeSignature(timestamp, rawBody, secret), "hex");
  const ok = candidates.some((candidate) => {
    const received = Buffer.from(candidate, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
  if (!ok) throw new UnauthorizedError("Invalid Stripe-Signature");
}
