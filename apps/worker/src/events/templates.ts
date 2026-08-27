import type { DomainEventPayload, DomainEventType } from "@habit-tracker/queues";
import type { NotificationType } from "@habit-tracker/types";

/**
 * What each domain event turns into (L11 fan-out). One event, N channels:
 *  - `inApp`  → a `notifications` row + SSE push to the recipient
 *  - `email`  → an email job, only if the recipient opted in
 * The router (events.worker.ts) resolves recipients and preferences; this
 * file only knows *wording*.
 */
export interface NotificationPlan {
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  /** email subject/text; undefined = in-app only */
  email?: { subject: string; text: string };
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase()
  }).format(amount / 100);
}

export const templates = {
  followCreated(
    p: DomainEventPayload<"follow.created">,
    followerName: string,
    webUrl: string
  ): NotificationPlan {
    return {
      type: "follow.created",
      title: `${followerName} started following you`,
      body: "Follow back to share friends-only habits with each other.",
      data: { followerId: p.followerId },
      email: {
        subject: `${followerName} started following you on Habit Tracker`,
        text: `${followerName} now follows your habit feed.\n\nSee their profile: ${webUrl}/users/${p.followerId}`
      }
    };
  },

  streakMilestone(p: DomainEventPayload<"checkin.created">, webUrl: string): NotificationPlan {
    const days = p.milestone ?? p.streakAfter;
    return {
      type: "streak.milestone",
      title: `🔥 ${days}-day streak on “${p.habitName}”!`,
      body: "Consistency beats intensity. Keep it going tomorrow.",
      data: { habitId: p.habitId, streak: p.streakAfter, milestone: p.milestone },
      email: {
        subject: `${days} days in a row — “${p.habitName}”`,
        text: `You just hit a ${days}-day streak on “${p.habitName}”. 🔥\n\n${webUrl}/habits/${p.habitId}`
      }
    };
  },

  paymentSucceeded(p: DomainEventPayload<"payment.succeeded">): NotificationPlan {
    const money = formatMoney(p.amount, p.currency);
    return {
      type: "payment.succeeded",
      title: "Welcome to Pro 🎉",
      body: `We received your payment of ${money}. Thank you!`,
      data: { paymentId: p.paymentId },
      email: {
        subject: "Your Habit Tracker Pro receipt",
        text: `Thanks for upgrading! Payment of ${money} received.\nPayment id: ${p.paymentId}`
      }
    };
  },

  paymentFailed(p: DomainEventPayload<"payment.failed">): NotificationPlan {
    return {
      type: "payment.failed",
      title: "Payment failed",
      body: p.reason ?? "Your card was declined. No charge was made — you can try again.",
      data: { paymentId: p.paymentId },
      email: {
        subject: "Your Habit Tracker payment did not go through",
        text: `We could not complete your payment${p.reason ? `: ${p.reason}` : ""}.\nNothing was charged. You can retry from the app.`
      }
    };
  },

  fileProcessed(p: DomainEventPayload<"file.processed">): NotificationPlan {
    return p.status === "ready"
      ? { type: "file.ready", title: "Your photo is ready", body: null, data: { fileId: p.fileId } }
      : {
          type: "file.rejected",
          title: "Upload rejected",
          body: p.reason ?? "The file did not pass validation.",
          data: { fileId: p.fileId }
        };
  }
} satisfies Record<string, (...args: never[]) => NotificationPlan>;

export type TemplateEventType = Exclude<DomainEventType, "user.created">;
