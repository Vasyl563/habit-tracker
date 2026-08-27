import { Hono } from "hono";
import type { AppEnv } from "../../app-env.js";
import { HttpException, ValidationError } from "../../lib/errors.js";
import { verifyStripeSignature } from "./stripe-signature.js";
import { type StripeWebhookService, stripeEventSchema } from "./stripe-webhook.service.js";

/**
 * POST /webhooks/stripe — NO session middleware (Stripe signs it instead),
 * raw body preserved for the signature, always answers fast: 200 when the
 * event was processed or is a duplicate, 401 on a bad signature so Stripe
 * retries with backoff, 503 when the webhook secret isn't configured.
 *
 * Locally: stripe listen --forward-to localhost:3005/webhooks/stripe
 */
export function createStripeWebhookRoutes(
  service: StripeWebhookService,
  secret: string | undefined
) {
  const routes = new Hono<AppEnv>();

  routes.post("/webhooks/stripe", async (c) => {
    if (!secret) {
      throw new HttpException(
        503,
        "SERVICE_UNAVAILABLE",
        "STRIPE_WEBHOOK_SECRET is not configured"
      );
    }
    const raw = await c.req.text(); // raw body — re-serialised JSON would break the HMAC
    verifyStripeSignature(raw, c.req.header("stripe-signature"), secret);

    const parsed = stripeEventSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new ValidationError("Unrecognised Stripe event shape", parsed.error.issues);

    const outcome = await service.handle(parsed.data);
    c.get("logger").info(
      { eventId: parsed.data.id, type: parsed.data.type, outcome },
      "stripe webhook"
    );
    return c.json({ received: true, outcome }, 200);
  });

  return routes;
}
