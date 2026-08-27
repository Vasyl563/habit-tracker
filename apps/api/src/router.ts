import { os } from "./lib/orpc.js";
import { billingController } from "./modules/billing/billing.controller.js";
import { checkInsController } from "./modules/check-ins/check-ins.controller.js";
import { feedController } from "./modules/feed/feed.controller.js";
import { filesController } from "./modules/files/files.controller.js";
import { followsController } from "./modules/follows/follows.controller.js";
import { habitsController } from "./modules/habits/habits.controller.js";
import { notificationsController } from "./modules/notifications/notifications.controller.js";
import { usersController } from "./modules/users/users.controller.js";

/**
 * The oRPC router — module controllers assembled in the shape of the
 * contract. `os.router(...)` type-checks that every contract procedure has an
 * implementation and nothing extra sneaked in.
 */
export const router = os.router({
  users: usersController,
  habits: habitsController,
  checkIns: checkInsController,
  follows: followsController,
  feed: feedController,
  notifications: notificationsController,
  files: filesController,
  billing: billingController
});

export type AppRouter = typeof router;
