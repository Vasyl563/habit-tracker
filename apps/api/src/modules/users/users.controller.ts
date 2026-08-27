import { authed } from "../../lib/orpc.js";

/**
 * Controller (L4): the thin HTTP-facing layer. It reads input + context,
 * calls ONE service method, returns the DTO. No business logic, no
 * try/catch (the global handler owns errors), no SQL.
 */
export const usersController = {
  me: authed.users.me.handler(({ context }) => context.services.users.me(context.user.id)),

  updateMe: authed.users.updateMe.handler(({ context, input }) =>
    context.services.users.updateMe(context.user.id, input)
  ),

  updateSettings: authed.users.updateSettings.handler(({ context, input }) =>
    context.services.users.updateSettings(context.user.id, input)
  ),

  search: authed.users.search.handler(({ context, input }) => context.services.users.search(input)),

  profile: authed.users.profile.handler(({ context, input }) =>
    context.services.users.profile(context.user.id, input.userId)
  )
};
