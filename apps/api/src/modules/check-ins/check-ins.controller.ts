import { authed, rateLimited } from "../../lib/orpc.js";

/** Writes get a per-user sliding-window limit (L9): 60 check-ins / minute is plenty for humans. */
const writeLimit = rateLimited("check-ins:write", { limit: 60, windowSeconds: 60 });

export const checkInsController = {
  create: authed.checkIns.create
    .use(writeLimit)
    .handler(({ context, input }) => context.services.checkIns.create(context.user.id, input)),

  remove: authed.checkIns.remove.use(writeLimit).handler(async ({ context, input }) => {
    await context.services.checkIns.remove(context.user.id, input.habitId, input.date);
    return { ok: true as const };
  }),

  list: authed.checkIns.list.handler(({ context, input }) =>
    context.services.checkIns.list(context.user.id, input)
  )
};
