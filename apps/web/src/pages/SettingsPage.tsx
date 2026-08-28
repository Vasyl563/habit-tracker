import type { SseEvent } from "@habit-tracker/types";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";
import { useSse } from "../api/sse.js";
import { Avatar } from "../components/Avatar.js";
import { useI18n } from "../lib/i18n.js";
import { dateTime } from "../lib/ui.js";

const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = stripeKey ? loadStripe(stripeKey) : null;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const me = useQuery(orpc.users.me.queryOptions());
  const billing = useQuery(orpc.billing.status.queryOptions());
  const [msg, setMsg] = useState<string | null>(null);
  const refreshMe = () => void queryClient.invalidateQueries({ queryKey: orpc.users.me.key() });

  const updateMe = useMutation(
    orpc.users.updateMe.mutationOptions({
      onSuccess: refreshMe,
      onError: (e) => setMsg(describeError(e, t))
    })
  );
  const updateSettings = useMutation(
    orpc.users.updateSettings.mutationOptions({
      onSuccess: refreshMe,
      onError: (e) => setMsg(describeError(e, t))
    })
  );

  function onProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    updateMe.mutate({ name: String(f.get("name")), bio: String(f.get("bio") || "") || null });
    setMsg(t("settings.saved"));
  }

  if (me.isLoading)
    return (
      <div className="center">
        <span className="spinner" /> {t("feed.loading")}
      </div>
    );
  if (me.isError || !me.data) return <p className="banner error">{describeError(me.error, t)}</p>;
  const user = me.data;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
          <p className="sub">
            {t("settings.account")} {user.email} ·{" "}
            {user.emailVerified ? t("settings.verified") : t("settings.notVerified")} ·{" "}
            {t("settings.plan")}{" "}
            <strong>{user.plan === "pro" ? "Pro ⭐" : t("settings.planFree")}</strong>
          </p>
        </div>
      </div>
      {msg ? <p className="banner notice">{msg}</p> : null}

      <section className="card stack">
        <h2>{t("settings.profile")}</h2>
        <form className="stack" onSubmit={onProfile}>
          <div className="field-grid">
            <label>
              {t("settings.name")}{" "}
              <input name="name" defaultValue={user.name} required maxLength={80} />
            </label>
            <label>
              {t("settings.bio")}{" "}
              <input
                name="bio"
                defaultValue={user.bio ?? ""}
                maxLength={280}
                placeholder={t("settings.bioPlaceholder")}
              />
            </label>
          </div>
          <div className="row">
            <button type="submit" disabled={updateMe.isPending}>
              {t("settings.save")}
            </button>
          </div>
        </form>
      </section>

      <section className="card stack">
        <h2>{t("settings.avatar")}</h2>
        <p className="muted small">{t("settings.avatarHint")}</p>
        <AvatarUpload name={user.name} currentImage={user.image} onDone={refreshMe} />
      </section>

      <section className="card stack">
        <h2>{t("settings.notifications")}</h2>
        <label className="switch">
          <input
            type="checkbox"
            checked={user.settings.emailNotifications}
            onChange={(e) => updateSettings.mutate({ emailNotifications: e.target.checked })}
          />
          <span className="track" />
          {t("settings.emailNotif")}
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={user.settings.weeklyDigest}
            onChange={(e) => updateSettings.mutate({ weeklyDigest: e.target.checked })}
          />
          <span className="track" />
          {t("settings.weeklyDigest")}
        </label>
      </section>

      <section className="card stack">
        <h2>{t("settings.pro")}</h2>
        {billing.data?.plan === "pro" ? (
          <p className="banner notice">{t("settings.onPro")}</p>
        ) : stripePromise ? (
          <ProCheckout
            onPaid={() => void queryClient.invalidateQueries({ queryKey: orpc.billing.key() })}
          />
        ) : (
          <p className="muted small">
            {t("settings.stripeHintA")} <code>VITE_STRIPE_PUBLISHABLE_KEY</code>{" "}
            {t("settings.stripeHintB")} <code>STRIPE_SECRET_KEY</code>
            {t("settings.stripeHintC")}
          </p>
        )}
        {billing.data && billing.data.payments.length > 0 ? (
          <ul className="payments">
            {billing.data.payments.map((p) => (
              <li key={p.id}>
                <span>{dateTime(p.createdAt, locale)}</span>
                <span>
                  {(p.amount / 100).toFixed(2)} {p.currency.toUpperCase()} · {p.status}
                </span>
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
  name,
  currentImage,
  onDone
}: {
  name: string;
  currentImage: string | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
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
      setProgress(
        event.status === "ready"
          ? t("upload.ready")
          : t("upload.rejected", { reason: event.reason ?? "" })
      );
      onDone();
    }
  }, Boolean(fileId));

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setProgress(t("upload.requesting"));
    try {
      const signed = await presign.mutateAsync({
        kind: "avatar",
        filename: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        size: file.size
      });
      setProgress(t("upload.uploading"));
      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: signed.headers,
        body: file
      });
      if (!put.ok) throw new Error(t("upload.storageError", { status: put.status }));
      setFileId(signed.fileId);
      setProgress(t("upload.acking"));
      await ack.mutateAsync({ id: signed.fileId });
      setProgress(t("upload.queued"));
    } catch (err) {
      setError(describeError(err, t));
      setProgress(null);
    }
  }

  return (
    <div className="row">
      <Avatar name={name} image={currentImage} size="lg" />
      <label className="stack tight">
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onChange} />
        {progress ? <span className="muted small">{progress}</span> : null}
        {error ? <span className="error small">{error}</span> : null}
      </label>
    </div>
  );
}

/** Stripe Payment Intent flow, client half (L12): confirm with the clientSecret; the webhook does fulfilment. */
function ProCheckout({ onPaid }: { onPaid: () => void }) {
  const { t } = useI18n();
  const checkout = useMutation(orpc.billing.checkout.mutationOptions());
  if (!checkout.data) {
    return (
      <div className="stack tight">
        <p className="muted small">{t("settings.upgradeIntro")}</p>
        <div className="row">
          <button type="button" onClick={() => checkout.mutate({})} disabled={checkout.isPending}>
            {t("settings.upgrade")}
          </button>
        </div>
        {checkout.error ? <p className="banner error">{describeError(checkout.error, t)}</p> : null}
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
  const { t } = useI18n();
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
      setError(result.error.message ?? t("pay.failed"));
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
          ? t("pay.confirming")
          : t("pay.pay", { amount: (amount / 100).toFixed(2), currency: currency.toUpperCase() })}
      </button>
      {error ? <p className="banner error">{error}</p> : null}
      <p className="muted small">{t("pay.testCard")}</p>
    </form>
  );
}
