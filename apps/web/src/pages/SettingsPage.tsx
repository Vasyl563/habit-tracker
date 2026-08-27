import type { SseEvent } from "@habit-tracker/types";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";
import { useSse } from "../api/sse.js";

const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = stripeKey ? loadStripe(stripeKey) : null;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const me = useQuery(orpc.users.me.queryOptions());
  const billing = useQuery(orpc.billing.status.queryOptions());
  const [msg, setMsg] = useState<string | null>(null);
  const refreshMe = () => void queryClient.invalidateQueries({ queryKey: orpc.users.me.key() });

  const updateMe = useMutation(
    orpc.users.updateMe.mutationOptions({
      onSuccess: refreshMe,
      onError: (e) => setMsg(describeError(e))
    })
  );
  const updateSettings = useMutation(
    orpc.users.updateSettings.mutationOptions({
      onSuccess: refreshMe,
      onError: (e) => setMsg(describeError(e))
    })
  );

  function onProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    updateMe.mutate({ name: String(f.get("name")), bio: String(f.get("bio") || "") || null });
    setMsg("Profile saved");
  }

  if (me.isLoading) return <p className="muted">Loading…</p>;
  if (me.isError || !me.data) return <p className="error">{describeError(me.error)}</p>;
  const user = me.data;

  return (
    <div className="stack">
      <h1>Settings</h1>
      {msg ? <p className="notice">{msg}</p> : null}

      <section className="card stack">
        <h2>Profile</h2>
        <form className="stack" onSubmit={onProfile}>
          <label>
            Name <input name="name" defaultValue={user.name} required maxLength={80} />
          </label>
          <label>
            Bio <input name="bio" defaultValue={user.bio ?? ""} maxLength={280} />
          </label>
          <div className="row">
            <button type="submit">Save</button>
            <span className="muted">
              {user.email} · {user.emailVerified ? "verified" : "email not verified"} · plan{" "}
              <strong>{user.plan}</strong>
            </span>
          </div>
        </form>
      </section>

      <section className="card stack">
        <h2>Avatar</h2>
        <AvatarUpload currentImage={user.image} onDone={refreshMe} />
      </section>

      <section className="card stack">
        <h2>Notifications</h2>
        <label className="row">
          <input
            type="checkbox"
            checked={user.settings.emailNotifications}
            onChange={(e) => updateSettings.mutate({ emailNotifications: e.target.checked })}
          />
          Email me about follows, streak milestones and receipts
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={user.settings.weeklyDigest}
            onChange={(e) => updateSettings.mutate({ weeklyDigest: e.target.checked })}
          />
          Weekly digest
        </label>
      </section>

      <section className="card stack">
        <h2>Pro plan</h2>
        {billing.data?.plan === "pro" ? (
          <p>You are on Pro 🎉</p>
        ) : stripePromise ? (
          <ProCheckout
            onPaid={() => void queryClient.invalidateQueries({ queryKey: orpc.billing.key() })}
          />
        ) : (
          <p className="muted">
            Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> (and the server's{" "}
            <code>STRIPE_SECRET_KEY</code>) to enable checkout.
          </p>
        )}
        {billing.data && billing.data.payments.length > 0 ? (
          <ul className="muted small">
            {billing.data.payments.map((p) => (
              <li key={p.id}>
                {new Date(p.createdAt).toLocaleString()} · {(p.amount / 100).toFixed(2)}{" "}
                {p.currency.toUpperCase()} · {p.status}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Presigned upload from the browser (L12): ask → PUT straight to storage →
 * ack. The API never sees the bytes; the worker's verdict arrives over SSE.
 */
function AvatarUpload({
  currentImage,
  onDone
}: {
  currentImage: string | null;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const presign = useMutation(orpc.files.presignUpload.mutationOptions());
  const ack = useMutation(orpc.files.ack.mutationOptions());

  useSse((event: SseEvent) => {
    if (!fileId) return;
    if (event.type === "file.progress" && event.fileId === fileId)
      setProgress(`${event.step} ${event.pct}%`);
    if (event.type === "file.done" && event.fileId === fileId) {
      setProgress(event.status === "ready" ? "ready ✓" : `rejected: ${event.reason ?? ""}`);
      onDone();
    }
  }, Boolean(fileId));

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setProgress("requesting upload URL…");
    try {
      const signed = await presign.mutateAsync({
        kind: "avatar",
        filename: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        size: file.size
      });
      setProgress("uploading to storage…");
      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: signed.headers,
        body: file
      });
      if (!put.ok) throw new Error(`storage answered ${put.status}`);
      setFileId(signed.fileId);
      setProgress("acknowledging…");
      await ack.mutateAsync({ id: signed.fileId });
      setProgress("queued for processing…");
    } catch (err) {
      setError(describeError(err));
      setProgress(null);
    }
  }

  return (
    <div className="row">
      {currentImage ? (
        <img className="avatar lg" src={currentImage} alt="" />
      ) : (
        <div className="avatar lg placeholder" />
      )}
      <label className="stack">
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onChange} />
        {progress ? <span className="muted small">{progress}</span> : null}
        {error ? <span className="error">{error}</span> : null}
      </label>
    </div>
  );
}

/** Stripe Payment Intent flow, client half (L12): confirm with the clientSecret; the webhook does fulfilment. */
function ProCheckout({ onPaid }: { onPaid: () => void }) {
  const checkout = useMutation(orpc.billing.checkout.mutationOptions());
  if (!checkout.data) {
    return (
      <div className="stack">
        <button type="button" onClick={() => checkout.mutate({})} disabled={checkout.isPending}>
          Upgrade to Pro
        </button>
        {checkout.error ? <p className="error">{describeError(checkout.error)}</p> : null}
      </div>
    );
  }
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: checkout.data.clientSecret }}>
      <PayForm amount={checkout.data.amount} currency={checkout.data.currency} onPaid={onPaid} />
    </Elements>
  );
}

function PayForm({
  amount,
  currency,
  onPaid
}: {
  amount: number;
  currency: string;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "paying" | "done">("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setState("paying");
    const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (result.error) {
      setError(result.error.message ?? "Payment failed");
      setState("idle");
      return;
    }
    setState("done");
    // the *webhook* flips the plan; the UI just waits for it
    setTimeout(onPaid, 2500);
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <PaymentElement />
      <button type="submit" disabled={!stripe || state !== "idle"}>
        {state === "done"
          ? "Thanks — confirming with Stripe…"
          : `Pay ${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`}
      </button>
      {error ? <p className="error">{error}</p> : null}
      <p className="muted small">Test card: 4242 4242 4242 4242, any future date, any CVC.</p>
    </form>
  );
}
