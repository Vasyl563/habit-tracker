import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";
import { Avatar } from "../components/Avatar.js";
import { useI18n } from "../lib/i18n.js";
import { monthYear } from "../lib/ui.js";

export function ProfilePage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { locale, t, tp } = useI18n();
  const profile = useQuery(
    orpc.users.profile.queryOptions({ input: { userId: id }, enabled: Boolean(id) })
  );
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.users.profile.key({ input: { userId: id } })
    });
    void queryClient.invalidateQueries({ queryKey: orpc.feed.key() });
  };
  const follow = useMutation(orpc.follows.follow.mutationOptions({ onSuccess: refresh }));
  const unfollow = useMutation(orpc.follows.unfollow.mutationOptions({ onSuccess: refresh }));

  if (profile.isLoading)
    return (
      <div className="center">
        <span className="spinner" /> {t("profile.loading")}
      </div>
    );
  if (profile.isError) return <p className="banner error">{describeError(profile.error, t)}</p>;
  if (!profile.data) return null;
  const { user, stats, viewer } = profile.data;
  const err = follow.error ?? unfollow.error;

  return (
    <div className="stack">
      <div className="card row wrap">
        <Avatar name={user.name} image={user.image} size="lg" />
        <div className="grow">
          <h1>{user.name}</h1>
          {user.bio ? <p className="muted">{user.bio}</p> : null}
          <p className="muted small">
            {t("profile.joined", { date: monthYear(user.createdAt, locale) })}
          </p>
        </div>
        {!viewer.isMe ? (
          <div className="stack tight" style={{ alignItems: "flex-end" }}>
            {viewer.isFollowing ? (
              <button
                type="button"
                className="secondary"
                onClick={() => unfollow.mutate({ userId: id })}
              >
                {t("profile.following")}
              </button>
            ) : (
              <button type="button" onClick={() => follow.mutate({ userId: id })}>
                {t("profile.follow")}
              </button>
            )}
            {viewer.isFollowedBy ? (
              <span className="muted small">
                {t("profile.followsYou")}
                {viewer.isFollowing ? t("profile.friends") : ""}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {err ? <p className="banner error">{describeError(err, t)}</p> : null}

      <ul className="stat-grid">
        <li className="stat">
          <strong>{stats.habitsTracked}</strong> <span>{t("stat.habits")}</span>
        </li>
        <li className="stat">
          <strong>{stats.totalCheckIns}</strong> <span>{t("stat.checkIns")}</span>
        </li>
        <li className="stat">
          <strong>{stats.longestStreak}</strong> <span>{t("stat.longestStreak")}</span>
        </li>
        <li className="stat">
          <strong>{stats.followers}</strong> <span>{t("stat.followers")}</span>
        </li>
        <li className="stat">
          <strong>{stats.following}</strong> <span>{t("stat.following")}</span>
        </li>
      </ul>

      {stats.currentStreaks.length > 0 ? (
        <section className="card stack tight">
          <h2>{t("profile.currentStreaks")}</h2>
          <ul className="list stack tight">
            {stats.currentStreaks.map((s) => (
              <li key={s.habitId} className="row space">
                <span>{s.habitName}</span>
                <span className="streak">
                  🔥 {s.currentStreak}
                  <span className="unit">{tp(s.currentStreak, "unit.day")}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
