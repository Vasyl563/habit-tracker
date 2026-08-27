import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router";
import { signOut, useSession } from "../api/auth.js";
import { orpc } from "../api/client.js";
import { useSse } from "../api/sse.js";

export function Layout() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const unread = useQuery(orpc.notifications.unreadCount.queryOptions());

  // live badge: the worker publishes on every new notification (SSE, L11)
  const sseStatus = useSse((event) => {
    if (event.type === "unread-count") {
      queryClient.setQueryData(orpc.notifications.unreadCount.queryKey(), { count: event.count });
    }
    if (event.type === "notification") {
      void queryClient.invalidateQueries({ queryKey: orpc.notifications.list.key() });
    }
    if (event.type === "file.done") {
      void queryClient.invalidateQueries({ queryKey: orpc.files.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.users.me.key() });
    }
  });

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/habits" className="brand">
          🎯 Habit Tracker
        </NavLink>
        <nav>
          <NavLink to="/habits">Habits</NavLink>
          <NavLink to="/feed">Feed</NavLink>
          <NavLink to="/notifications">
            Inbox{" "}
            {unread.data && unread.data.count > 0 ? (
              <span className="badge">{unread.data.count}</span>
            ) : null}
          </NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="user">
          <span className="muted" title={`SSE: ${sseStatus}`}>
            {sseStatus === "open" ? "●" : "○"}
          </span>
          {session?.user.image ? <img className="avatar" src={session.user.image} alt="" /> : null}
          <span>{session?.user.name}</span>
          <button
            type="button"
            className="link"
            onClick={async () => {
              await signOut();
              queryClient.clear();
              navigate("/sign-in");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
