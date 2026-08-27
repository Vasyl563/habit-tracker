import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";

export function NotificationsPage() {
  const queryClient = useQueryClient();
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
      <div className="row space">
        <h1>Inbox</h1>
        <button type="button" className="secondary" onClick={() => markAll.mutate({})}>
          Mark all read
        </button>
      </div>
      {list.isError ? <p className="error">{describeError(list.error)}</p> : null}
      {items.length === 0 && !list.isLoading ? <p className="muted">All quiet.</p> : null}
      <ul className="stack">
        {items.map((n) => (
          <li key={n.id} className={`card row space ${n.readAt ? "read" : "unread"}`}>
            <div>
              <strong>{n.title}</strong>
              {n.body ? <div className="muted">{n.body}</div> : null}
              <div className="muted small">
                {n.type} · {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
            {!n.readAt ? (
              <button type="button" className="link" onClick={() => markRead.mutate({ id: n.id })}>
                mark read
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <button type="button" onClick={() => list.fetchNextPage()}>
          Load more
        </button>
      ) : null}
    </div>
  );
}
