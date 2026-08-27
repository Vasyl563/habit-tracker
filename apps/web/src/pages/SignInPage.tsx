import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { signIn, useSession } from "../api/auth.js";

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const session = useSession();
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
    if (res.error) setError(res.error.message ?? "Sign-in failed");
  }

  return (
    <div className="auth-card">
      <h1>Sign in</h1>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue="ada@example.com"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            defaultValue="Password123!"
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? "…" : "Sign in"}
        </button>
      </form>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          signIn.social({ provider: "github", callbackURL: `${window.location.origin}/habits` })
        }
      >
        Continue with GitHub
      </button>
      <p className="muted">
        No account? <Link to="/sign-up">Sign up</Link>. Seeded users use password{" "}
        <code>Password123!</code>.
      </p>
    </div>
  );
}
