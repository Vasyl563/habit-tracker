import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { signUp, useSession } from "../api/auth.js";
import { LangSwitch } from "../components/LangSwitch.js";
import { useI18n } from "../lib/i18n.js";

export function SignUpPage() {
  const navigate = useNavigate();
  const session = useSession();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.data) navigate("/habits", { replace: true });
  }, [session.data, navigate]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password"))
    });
    setBusy(false);
    if (res.error) setError(res.error.message ?? t("signup.failed"));
  }

  return (
    <div className="auth-shell">
      <LangSwitch floating />
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo" aria-hidden>
            🎯
          </span>
          <h1>{t("signup.title")}</h1>
          <span className="tagline">{t("signup.tagline")}</span>
        </div>
        <form onSubmit={onSubmit} className="stack">
          <label>
            {t("signup.name")}
            <input
              name="name"
              required
              minLength={1}
              maxLength={80}
              placeholder={t("signup.namePlaceholder")}
            />
          </label>
          <label>
            {t("auth.email")}
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <label>
            <span>
              {t("auth.password")} <span className="muted">{t("signup.passwordHint")}</span>
            </span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="banner error">{error}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? t("signup.creating") : t("signup.submit")}
          </button>
        </form>
        <p className="hint">
          {t("signup.haveAccount")} <Link to="/sign-in">{t("signup.signInLink")}</Link>
        </p>
      </div>
    </div>
  );
}
