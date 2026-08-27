import { payments, users, webhookEvents } from "@habit-tracker/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeStripeSignature } from "../modules/webhooks/stripe-signature.js";
import { createTestApp, type Session, signUp, type TestApp } from "./helpers.js";

/**
 * Stripe webhook end to end without Stripe: we sign the payload ourselves
 * with the test secret. Verifies signature check, the succeeded path
 * (payment → succeeded, user → pro), and idempotency on redelivery.
 */
describe("stripe webhook", () => {
  let t: TestApp;
  let me: Session;
  let paymentId: string;
  const secret = "whsec_test_secret";

  const post = (event: unknown, sigOverride?: string) => {
    const raw = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = sigOverride ?? computeStripeSignature(ts, raw, secret);
    return t.app.request("/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` },
      body: raw
    });
  };

  beforeAll(async () => {
    t = await createTestApp();
    await t.reset();
    me = await signUp(t.app, "Payer");
    const [row] = await t.container.db
      .insert(payments)
      .values({
        userId: me.userId,
        amount: 500,
        currency: "usd",
        stripePaymentIntentId: "pi_test_1"
      })
      .returning();
    paymentId = row?.id as string;
  });
  afterAll(() => t?.close());

  it("rejects a bad signature with 401 and never touches the DB", async () => {
    const res = await post(
      {
        id: "evt_bad",
        type: "payment_intent.succeeded",
        created: 1,
        data: { object: { id: "pi_test_1", object: "payment_intent", metadata: {} } }
      },
      "00"
    );
    expect(res.status).toBe(401);
    const seen = await t.container.db.select().from(webhookEvents);
    expect(seen).toHaveLength(0);
  });

  it("payment_intent.succeeded → payment succeeded, user upgraded to pro", async () => {
    const event = {
      id: "evt_ok_1",
      type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "pi_test_1",
          object: "payment_intent",
          metadata: { paymentId, userId: me.userId }
        }
      }
    };
    const res = await post(event);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "processed" });

    const [payment] = await t.container.db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId));
    expect(payment?.status).toBe("succeeded");
    const [user] = await t.container.db.select().from(users).where(eq(users.id, me.userId));
    expect(user?.plan).toBe("pro");
  });

  it("redelivery of the same event is a no-op (idempotency table)", async () => {
    const event = {
      id: "evt_ok_1",
      type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "pi_test_1",
          object: "payment_intent",
          metadata: { paymentId, userId: me.userId }
        }
      }
    };
    const res = await post(event);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "duplicate" });
    const seen = await t.container.db.select().from(webhookEvents);
    expect(seen).toHaveLength(1);
  });

  it("unknown event types are acknowledged and ignored", async () => {
    const res = await post({
      id: "evt_other",
      type: "customer.created",
      created: 1,
      data: { object: { id: "cus_1", object: "customer", metadata: {} } }
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "ignored" });
  });
});
