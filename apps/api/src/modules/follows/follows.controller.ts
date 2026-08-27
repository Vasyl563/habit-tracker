import { authed } from "../../lib/orpc.js";

export const followsController = {
  follow: authed.follows.follow.handler(async ({ context, input }) => {
    await context.services.follows.follow(context.user.id, input.userId);
    return { ok: true as const };
  }),

  unfollow: authed.follows.unfollow.handler(async ({ context, input }) => {
    await context.services.follows.unfollow(context.user.id, input.userId);
    return { ok: true as const };
  }),

  followers: authed.follows.followers.handler(({ context, input }) =>
    context.services.follows.followers(input.userId, input)
  ),

  following: authed.follows.following.handler(({ context, input }) =>
    context.services.follows.following(input.userId, input)
  )
};
