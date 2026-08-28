import type { NotificationType } from "@habit-tracker/types";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";
import { useI18n } from "../lib/i18n.js";
import { dateTime } from "../lib/ui.js";

const TYPE_ICONS: Record<NotificationType, string> = {
  "follow.created": "👥",
  "streak.milestone": "🔥",
  "payment.succeeded": "🧾",
  "payment.failed": "⚠️",
  "file.ready": "🖼️",
  "file.rejected": "🚫"
};

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const list = useInfiniteQuery(
    orpc.notifications.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ limit: 20, cursor, unreadOnly: false }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined
    })
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.notifications.key() });
  };
  const markRead = useMutation(orpc.notifications.markRead.mutationOptions({ onSuccess: refresh }));
  const markAll = useMutation(
    orpc.notifications.markAllRead.mutationOptions({ onSuccess: refresh })
  );
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("inbox.title")}</h1>
          <p className="sub">{t("inbox.sub")}</p>
        </div>
        <button type="button" className="secondary small" onClick={() => markAll.mutate({})}>
          {t("inbox.markAll")}
        </button>
      </div>
      {list.isError ? <p className="banner error">{describeError(list.error, t)}</p> : null}
      {items.length === 0 && !list.isLoading ? (
        <div className="empty">
          <span className="icon">🧘</span>
          {t("inbox.empty")}
        </div>
      ) : null}
      <ul className="stack tight">
        {items.map((n) => (
          <li key={n.id} className={`card notif ${n.readAt ? "read" : "unread"}`}>
            <span className="notif-icon" aria-hidden>
              {TYPE_ICONS[n.type] ?? "🔔"}
            </span>
            <div className="grow">
              <strong>{n.title}</strong>
              {n.body ? <div className="muted">{n.body}</div> : null}
              <div className="muted small">{dateTime(n.createdAt, locale)}</div>
            </div>
            {!n.readAt ? (
              <button
                type="button"
                className="link small"
                onClick={() => markRead.mutate({ id: n.id })}
              >
                {t("inbox.markRead")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <button type="button" className="secondary" onClick={() => list.fetchNextPage()}>
          {t("feed.loadMore")}
        </button>
      ) : null}
    </div>
  );
}
