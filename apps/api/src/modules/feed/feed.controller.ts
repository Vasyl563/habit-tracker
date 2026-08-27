import { authed } from "../../lib/orpc.js";

export const feedController = {
  list: authed.feed.list.handler(({ context, input }) =>
    context.services.feed.list(context.user.id, input)
  )
};
