import { authed } from "../../lib/orpc.js";

export const notificationsController = {
  list: authed.notifications.list.handler(({ context, input }) =>
    context.services.notifications.list(context.user.id, input)
  ),

  unreadCount: authed.notifications.unreadCount.handler(async ({ context }) => ({
    count: await context.services.notifications.unreadCount(context.user.id)
  })),

  markRead: authed.notifications.markRead.handler(({ context, input }) =>
    context.services.notifications.markRead(context.user.id, input.id)
  ),

  markAllRead: authed.notifications.markAllRead.handler(async ({ context }) => ({
    updated: await context.services.notifications.markAllRead(context.user.id)
  }))
};
