import { createAuthClient } from "better-auth/react";

/**
 * better-auth's React client (L10). Talks to /api/auth/* (proxied to the
 * API); the session cookie is HttpOnly so JS never sees the token.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin
});

export const { useSession, signIn, signUp, signOut } = authClient;
