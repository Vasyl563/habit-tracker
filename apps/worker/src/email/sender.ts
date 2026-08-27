import type { Logger } from "@habit-tracker/logger";
import { retry, UnrecoverableError } from "@habit-tracker/shared";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { Env } from "../config/env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * The email provider behind an interface (L11/L12 self-study: "isolate the
 * SDK behind an interface"). Swapping Mailpit (dev) for Resend (prod) is an
 * env var, not a code change — and tests can pass a fake.
 */
export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

export function createEmailSender(env: Env, logger: Logger): EmailSender {
  switch (env.EMAIL_PROVIDER) {
    case "smtp": {
      // Mailpit locally: SMTP on :1025, inbox UI on :8025
      const transport = nodemailer.createTransport(env.SMTP_URL as string);
      return {
        name: "smtp",
        async send(message) {
          const info = await retry(() => transport.sendMail({ from: env.EMAIL_FROM, ...message }), {
            retries: 3,
            onRetry: ({ attempt, delayMs, error }) =>
              logger.warn({ attempt, delayMs, err: error }, "smtp send failed — retrying")
          });
          return { id: info.messageId ?? null };
        }
      };
    }
    case "resend": {
      const resend = new Resend(env.RESEND_API_KEY as string);
      return {
        name: "resend",
        async send(message) {
          const { data, error } = await resend.emails.send({ from: env.EMAIL_FROM, ...message });
          if (error) {
            // Resend tells us when it's our fault (validation) — don't retry those
            const permanent = /validation|invalid|not_found|missing/i.test(error.name ?? "");
            if (permanent) throw new UnrecoverableError(`resend: ${error.name}: ${error.message}`);
            throw new Error(`resend: ${error.name}: ${error.message}`);
          }
          return { id: data?.id ?? null };
        }
      };
    }
    default:
      return {
        name: "console",
        async send(message) {
          logger.info(
            { to: message.to, subject: message.subject, preview: message.text.slice(0, 120) },
            "📧 email (console provider — not actually sent)"
          );
          return { id: null };
        }
      };
  }
}
