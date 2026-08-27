import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";

/** Feed-shaped resource → cursor pagination → "Load more" (L8). */
export function FeedPage() {
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
        <h1>Feed</h1>
        {feed.isError ? <p className="error">{describeError(feed.error)}</p> : null}
        {items.length === 0 && !feed.isLoading ? (
          <p className="muted">Nothing yet — follow someone from the “People” panel.</p>
        ) : null}
        <ul className="stack">
          {items.map((item) => (
            <li key={item.id} className="card">
              <Link to={`/users/${item.user.id}`}>
                <strong>{item.user.name}</strong>
              </Link>{" "}
              checked in <em>{item.habit.name}</em> for {item.date}
              {item.note ? <span className="muted"> — “{item.note}”</span> : null}
              <div className="muted">
                🔥 {item.habit.currentStreak} ·{" "}
                <span className={`tag tag-${item.habit.visibility}`}>{item.habit.visibility}</span>
              </div>
            </li>
          ))}
        </ul>
        {feed.hasNextPage ? (
          <button
            type="button"
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
          >
            {feed.isFetchingNextPage ? "…" : "Load more"}
          </button>
        ) : null}
      </section>

      <aside className="stack">
        <h2>People</h2>
        <input
          placeholder="find by name or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="stack">
          {(people.data?.items ?? []).map((u) => (
            <li key={u.id}>
              <Link to={`/users/${u.id}`}>{u.name}</Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
