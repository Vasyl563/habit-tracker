import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { userPlanSchema } from "./users.js";

export const paymentStatusSchema = z.enum(["pending", "succeeded", "failed", "canceled"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentSchema = z.object({
  id: uuidSchema,
  amount: z.number().int(),
  currency: z.string(),
  status: paymentStatusSchema,
  createdAt: isoDateTimeSchema
});
export type PaymentDto = z.infer<typeof paymentSchema>;

/** Server creates the Payment Intent; the browser confirms it with Stripe.js. */
export const checkoutResultSchema = z.object({
  paymentId: uuidSchema,
  clientSecret: z.string(),
  amount: z.number().int(),
  currency: z.string()
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

export const billingStatusSchema = z.object({
  plan: userPlanSchema,
  payments: z.array(paymentSchema)
});
export type BillingStatusDto = z.infer<typeof billingStatusSchema>;
