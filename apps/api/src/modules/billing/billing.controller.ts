import { authed, rateLimited } from "../../lib/orpc.js";

export const billingController = {
  checkout: authed.billing.checkout
    // one intent per second per user is more than enough; also protects Stripe quota
    .use(rateLimited("billing:checkout", { limit: 5, windowSeconds: 60 }))
    .handler(({ context }) => context.services.billing.checkout(context.user.id)),

  status: authed.billing.status.handler(({ context }) =>
    context.services.billing.status(context.user.id)
  )
};
