import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router";
import { signOut, useSession } from "../api/auth.js";
import { orpc } from "../api/client.js";
import { useSse } from "../api/sse.js";
import { type MessageKey, useI18n } from "../lib/i18n.js";
import { Avatar } from "./Avatar.js";
import { LangSwitch } from "./LangSwitch.js";

const NAV: readonly { to: string; icon: string; label: MessageKey }[] = [
  { to: "/habits", icon: "✅", label: "nav.habits" },
  { to: "/feed", icon: "📣", label: "nav.feed" },
  { to: "/notifications", icon: "🔔", label: "nav.inbox" },
  { to: "/settings", icon: "⚙️", label: "nav.settings" }
];

export function Layout() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useI18n();
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
          🎯 <span>Habit Tracker</span>
        </NavLink>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}>
              <span aria-hidden>{item.icon}</span>
              <span className="label">{t(item.label)}</span>
              {item.to === "/notifications" && unread.data && unread.data.count > 0 ? (
                <span className="badge">{unread.data.count}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <span
            className={`live-dot ${sseStatus === "open" ? "on" : ""}`}
            title={sseStatus === "open" ? t("layout.liveOn") : t("layout.liveOff")}
          />
          <LangSwitch />
          {session ? <Avatar name={session.user.name} image={session.user.image} /> : null}
          <span className="name">{session?.user.name}</span>
          <button
            type="button"
            className="link"
            onClick={async () => {
              await signOut();
              queryClient.clear();
              navigate("/sign-in");
            }}
          >
            {t("layout.signOut")}
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
