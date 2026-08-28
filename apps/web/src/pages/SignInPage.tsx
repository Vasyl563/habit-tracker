import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { signIn, useSession } from "../api/auth.js";
import { LangSwitch } from "../components/LangSwitch.js";
import { useI18n } from "../lib/i18n.js";

// local dev has the seeded users; production has the demo account
const DEMO = import.meta.env.DEV
  ? { email: "ada@example.com", password: "Password123!" }
  : { email: "demo@habit-tracker.app", password: "Demo1234!" };

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const session = useSession();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // navigate only once the session store actually has the user — avoids the
  // race where the protected route still sees "no session" and bounces back
  useEffect(() => {
    if (session.data) navigate(location.state?.from ?? "/habits", { replace: true });
  }, [session.data, navigate, location.state?.from]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password"))
    });
    setBusy(false);
    if (res.error) setError(res.error.message ?? t("auth.signInFailed"));
  }

  return (
    <div className="auth-shell">
      <LangSwitch floating />
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo" aria-hidden>
            🎯
          </span>
          <h1>Habit Tracker</h1>
          <span className="tagline">{t("auth.tagline")}</span>
        </div>
        <form onSubmit={onSubmit} className="stack">
          <label>
            {t("auth.email")}
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={DEMO.email}
            />
          </label>
          <label>
            {t("auth.password")}
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              defaultValue={DEMO.password}
            />
          </label>
          {error ? <p className="banner error">{error}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? t("auth.signingIn") : t("auth.signIn")}
          </button>
        </form>
        <div className="divider">{t("auth.or")}</div>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            signIn.social({ provider: "github", callbackURL: `${window.location.origin}/habits` })
          }
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          {t("auth.github")}
        </button>
        <p className="hint">
          {t("auth.hintDemo")}
          <br />
          {t("auth.noAccount")} <Link to="/sign-up">{t("auth.signUpLink")}</Link>
          {t("auth.tenSeconds")}
        </p>
      </div>
    </div>
  );
}
