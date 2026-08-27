import { type Db, isUniqueViolation, type Tx, webhookEvents } from "@habit-tracker/db";
import type { Logger } from "@habit-tracker/logger";
import { z } from "zod";
import { writeOutboxEvent } from "../../lib/outbox.js";
import type { BillingRepository } from "../billing/billing.repository.js";

/** The slice of a Stripe event we actually read — validated, not trusted. */
export const stripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number(),
  data: z.object({
    object: z.object({
      id: z.string(),
      object: z.string(),
      metadata: z.record(z.string(), z.string()).optional().default({}),
      last_payment_error: z.object({ message: z.string().nullish() }).nullish()
    })
  })
});
export type StripeEvent = z.infer<typeof stripeEventSchema>;

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

export class StripeWebhookService {
  constructor(
    private readonly db: Db,
    private readonly billingRepo: BillingRepository,
    private readonly logger: Logger
  ) {}

  /**
   * One transaction, three effects (L12):
   *   1. INSERT into webhook_events — a unique violation means we already
   *      processed this event.id → return without doing anything (idempotent).
   *   2. Apply the business change (payment status, user plan).
   *   3. Write the domain event to the outbox for the notification fan-out.
   * All three commit together or none do — a retry can never double-grant.
   */
  async handle(event: StripeEvent): Promise<WebhookOutcome> {
    return this.db.transaction(async (tx) => {
      try {
        await tx
          .insert(webhookEvents)
          .values({ id: event.id, provider: "stripe", type: event.type });
      } catch (error) {
        if (isUniqueViolation(error)) {
          this.logger.info({ eventId: event.id }, "stripe webhook: duplicate delivery ignored");
          return "duplicate";
        }
        throw error;
      }

      switch (event.type) {
        case "payment_intent.succeeded": {
          const payment = await this.resolvePayment(event, tx);
          if (!payment) return "ignored";
          await this.billingRepo.updatePayment(payment.id, { status: "succeeded" }, tx);
          await this.billingRepo.setPlan(payment.userId, "pro", tx);
          await writeOutboxEvent(
            tx,
            { type: "payment", id: payment.id },
            {
              type: "payment.succeeded",
              payload: {
                paymentId: payment.id,
                userId: payment.userId,
                amount: payment.amount,
                currency: payment.currency
              }
            }
          );
          return "processed";
        }
        case "payment_intent.payment_failed": {
          const payment = await this.resolvePayment(event, tx);
          if (!payment) return "ignored";
          await this.billingRepo.updatePayment(payment.id, { status: "failed" }, tx);
          await writeOutboxEvent(
            tx,
            { type: "payment", id: payment.id },
            {
              type: "payment.failed",
              payload: {
                paymentId: payment.id,
                userId: payment.userId,
                reason: event.data.object.last_payment_error?.message ?? null
              }
            }
          );
          return "processed";
        }
        case "payment_intent.canceled": {
          const payment = await this.resolvePayment(event, tx);
          if (!payment) return "ignored";
          await this.billingRepo.updatePayment(payment.id, { status: "canceled" }, tx);
          return "processed";
        }
        default:
          this.logger.debug({ type: event.type }, "stripe webhook: event type not handled");
          return "ignored";
      }
    });
  }

  /** find our payment row via metadata.paymentId, falling back to the intent id */
  private async resolvePayment(event: StripeEvent, tx: Tx) {
    const object = event.data.object;
    const byMeta = object.metadata.paymentId
      ? await this.billingRepo.findPayment(object.metadata.paymentId, tx)
      : null;
    const payment = byMeta ?? (await this.billingRepo.findByPaymentIntent(object.id, tx));
    if (!payment) {
      this.logger.warn({ eventId: event.id, intent: object.id }, "stripe webhook: unknown payment");
    }
    return payment;
  }
}
