import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { accounts, type Db, sessions, userSettings, users, verifications } from "@habit-tracker/db";
import { betterAuth } from "better-auth";

export interface AuthEmail {
  to: string;
  subject: string;
  text: string;
  template: "verify-email" | "reset-password";
}

export interface AuthConfig {
  db: Db;
  /** signs session cookies — `openssl rand -base64 32` */
  secret: string;
  /** public URL of the API — better-auth builds callback links from it */
  baseURL: string;
  /** origins allowed to call /api/auth with credentials (the web app) */
  trustedOrigins: string[];
  isProduction: boolean;
  github?: { clientId: string; clientSecret: string } | undefined;
  /** the API hands emails to the queue — auth never blocks on SMTP */
  sendEmail: (email: AuthEmail) => Promise<void>;
  /** best-effort hook after a user row exists (welcome email, analytics…) */
  onUserCreated?: (user: { id: string; email: string; name: string }) => Promise<void>;
  /** where hook failures go — they must never fail the sign-up itself */
  onHookError?: (error: unknown, hook: string) => void;
}

/**
 * better-auth (L10) on top of our Drizzle schema.
 *
 *  - Sessions are server-side rows (`sessions`), fronted by an HttpOnly,
 *    SameSite=Lax cookie. Revoking = deleting the row.
 *  - Email + password (scrypt hashes in `accounts.password`) + optional GitHub.
 *  - Verification / reset links go out through `sendEmail` → BullMQ (L11).
 *  - Rate limiting is *our* sliding-window middleware (L9), so the built-in
 *    limiter is off to avoid two limiters disagreeing.
 */
export function createAuth(config: AuthConfig) {
  return betterAuth({
    appName: "Habit Tracker",
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    trustedOrigins: config.trustedOrigins,

    database: drizzleAdapter(config.db, {
      provider: "pg",
      // better-auth model name → our (plural, snake_case) drizzle table
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications
      }
    }),

    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "habit",
      useSecureCookies: config.isProduction
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // verification email is *sent* on sign-up, but we don't block sign-in on it
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        // don't await network work here (timing attacks) — enqueue is ~1ms
        await config.sendEmail({
          to: user.email,
          subject: "Reset your Habit Tracker password",
          text: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your password.\nOpen this link to choose a new one:\n\n${url}\n\nIf it wasn't you, ignore this email.`,
          template: "reset-password"
        });
      }
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await config.sendEmail({
          to: user.email,
          subject: "Verify your email for Habit Tracker",
          text: `Welcome ${user.name}!\n\nPlease confirm your email address:\n\n${url}\n\nThe link expires in one hour.`,
          template: "verify-email"
        });
      }
    },

    socialProviders: config.github
      ? {
          github: {
            clientId: config.github.clientId,
            clientSecret: config.github.clientSecret
            // redirect URI to register at GitHub: {baseURL}/api/auth/callback/github
          }
        }
      : {},

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24 // extend once a day on activity
    },

    rateLimit: { enabled: false },

    databaseHooks: {
      user: {
        create: {
          // runs after the user row is committed; best-effort by design —
          // a Redis blip must not turn a successful sign-up into a 500
          after: async (user) => {
            try {
              // 1:1 settings row — idempotent, so a retry can't fail on the PK
              await config.db
                .insert(userSettings)
                .values({ userId: user.id })
                .onConflictDoNothing();
              await config.onUserCreated?.({ id: user.id, email: user.email, name: user.name });
            } catch (error) {
              config.onHookError?.(error, "user.create.after");
            }
          }
        }
      }
    }
  });
}

export type Auth = ReturnType<typeof createAuth>;
/** `{ session, user }` as returned by `auth.api.getSession()` */
export type AuthSession = Auth["$Infer"]["Session"];
export type SessionUser = AuthSession["user"];
