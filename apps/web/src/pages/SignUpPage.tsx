import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { signUp, useSession } from "../api/auth.js";

export function SignUpPage() {
  const navigate = useNavigate();
  const session = useSession();
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
    if (res.error) setError(res.error.message ?? "Sign-up failed");
  }

  return (
    <div className="auth-card">
      <h1>Create account</h1>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Name
          <input name="name" required minLength={1} maxLength={80} />
        </label>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password (min 8)
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? "…" : "Sign up"}
        </button>
      </form>
      <p className="muted">
        Already have an account? <Link to="/sign-in">Sign in</Link>
      </p>
    </div>
  );
}
