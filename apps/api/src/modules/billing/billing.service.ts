import type { Payment } from "@habit-tracker/db";
import type { BillingStatusDto, CheckoutResult, PaymentDto } from "@habit-tracker/types";
import type Stripe from "stripe";
import { ConflictError, HttpException, NotFoundError } from "../../lib/errors.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { BillingRepository } from "./billing.repository.js";

export function toPaymentDto(p: Payment): PaymentDto {
  return {
    id: p.id,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt.toISOString()
  };
}

export class BillingService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly usersRepo: UsersRepository,
    /** null when STRIPE_SECRET_KEY is not configured — endpoints answer 503 */
    private readonly stripe: Stripe | null,
    private readonly plan: { amount: number; currency: string }
  ) {}

  /**
   * Payment Intent flow, step 1 (L12): the server creates the intent, the
   * browser confirms it with Stripe.js using `clientSecret` — no card data
   * ever touches our API. Fulfilment happens in the *webhook*, never here.
   */
  async checkout(userId: string): Promise<CheckoutResult> {
    if (!this.stripe) {
      throw new HttpException(
        503,
        "SERVICE_UNAVAILABLE",
        "Payments are not configured on this server"
      );
    }
    const user = await this.usersRepo.findById(userId);
    if (!user) throw new NotFoundError("User");
    if (user.plan === "pro") throw new ConflictError("You are already on the Pro plan");

    const payment = await this.repo.createPayment({
      userId,
      amount: this.plan.amount,
      currency: this.plan.currency
    });

    const intent = await this.stripe.paymentIntents.create(
      {
        amount: this.plan.amount,
        currency: this.plan.currency,
        automatic_payment_methods: { enabled: true },
        // our ids ride along and come back in the webhook
        metadata: { paymentId: payment.id, userId },
        receipt_email: user.email
      },
      // Stripe-side idempotency: a retried request can't create two intents
      { idempotencyKey: `payment:${payment.id}` }
    );

    await this.repo.updatePayment(payment.id, { stripePaymentIntentId: intent.id });

    if (!intent.client_secret) throw new Error("Stripe returned no client_secret");
    return {
      paymentId: payment.id,
      clientSecret: intent.client_secret,
      amount: this.plan.amount,
      currency: this.plan.currency
    };
  }

  async status(userId: string): Promise<BillingStatusDto> {
    const [user, list] = await Promise.all([
      this.usersRepo.findById(userId),
      this.repo.listForUser(userId)
    ]);
    if (!user) throw new NotFoundError("User");
    return { plan: user.plan, payments: list.map(toPaymentDto) };
  }
}
