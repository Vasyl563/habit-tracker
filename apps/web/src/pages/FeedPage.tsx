import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";
import { Avatar } from "../components/Avatar.js";
import { useI18n } from "../lib/i18n.js";
import { humanDate } from "../lib/ui.js";

/** Feed-shaped resource → cursor pagination → "Load more" (L8). */
export function FeedPage() {
  const { locale, t, tp } = useI18n();
  const feed = useInfiniteQuery(
    orpc.feed.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ limit: 10, cursor }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined
    })
  );
  const [q, setQ] = useState("");
  const people = useQuery(
    orpc.users.search.queryOptions({ input: { q: q.trim() || undefined, limit: 8, offset: 0 } })
  );

  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="two-col">
      <section className="stack">
        <div className="page-head">
          <div>
            <h1>{t("feed.title")}</h1>
            <p className="sub">{t("feed.sub")}</p>
          </div>
        </div>
        {feed.isError ? <p className="banner error">{describeError(feed.error, t)}</p> : null}
        {items.length === 0 && !feed.isLoading ? (
          <div className="empty">
            <span className="icon">👋</span>
            {t("feed.empty")}
          </div>
        ) : null}
        <ul className="stack">
          {items.map((item) => (
            <li key={item.id} className="card feed-item">
              <Avatar name={item.user.name} image={item.user.image} />
              <div className="grow">
                <div className="row space wrap">
                  <span>
                    <Link to={`/users/${item.user.id}`}>
                      <strong>{item.user.name}</strong>
                    </Link>{" "}
                    {t("feed.checkedIn")} <strong>{item.habit.name}</strong>
                  </span>
                  <span className="when">{humanDate(item.date, locale, t)}</span>
                </div>
                <div className="habit-meta">
                  <span className="streak">
                    🔥 {item.habit.currentStreak}
                    <span className="unit">{tp(item.habit.currentStreak, "unit.day")}</span>
                  </span>
                  <span className={`tag tag-${item.habit.visibility}`}>
                    {t(`tag.${item.habit.visibility}`)}
                  </span>
                </div>
                {item.note ? <div className="note">“{item.note}”</div> : null}
              </div>
            </li>
          ))}
        </ul>
        {feed.hasNextPage ? (
          <button
            type="button"
            className="secondary"
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
          >
            {feed.isFetchingNextPage ? t("feed.loading") : t("feed.loadMore")}
          </button>
        ) : null}
      </section>

      <aside className="card stack">
        <h2>{t("feed.people")}</h2>
        <input
          placeholder={t("feed.peoplePlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="list people">
          {(people.data?.items ?? []).map((u) => (
            <li key={u.id}>
              <Link to={`/users/${u.id}`}>
                <Avatar name={u.name} image={u.image} />
                {u.name}
              </Link>
            </li>
          ))}
        </ul>
        {people.data && people.data.items.length === 0 ? (
          <p className="muted small">{t("feed.nobody")}</p>
        ) : null}
      </aside>
    </div>
  );
}
