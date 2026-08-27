import { authed } from "../../lib/orpc.js";

export const habitsController = {
  list: authed.habits.list.handler(({ context, input }) =>
    context.services.habits.list(context.user.id, input)
  ),

  get: authed.habits.get.handler(({ context, input }) =>
    context.services.habits.get(context.user.id, input.id)
  ),

  create: authed.habits.create.handler(({ context, input }) =>
    context.services.habits.create(context.user.id, input)
  ),

  update: authed.habits.update.handler(({ context, input }) =>
    context.services.habits.update(context.user.id, input)
  ),

  archive: authed.habits.archive.handler(({ context, input }) =>
    context.services.habits.archive(context.user.id, input.id)
  ),

  remove: authed.habits.remove.handler(async ({ context, input }) => {
    await context.services.habits.remove(context.user.id, input.id);
    return { ok: true as const };
  })
};
