import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";

export function ProfilePage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
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

  if (profile.isLoading) return <p className="muted">Loading…</p>;
  if (profile.isError) return <p className="error">{describeError(profile.error)}</p>;
  if (!profile.data) return null;
  const { user, stats, viewer } = profile.data;
  const err = follow.error ?? unfollow.error;

  return (
    <div className="stack">
      <div className="row">
        {user.image ? (
          <img className="avatar lg" src={user.image} alt="" />
        ) : (
          <div className="avatar lg placeholder" />
        )}
        <div>
          <h1>{user.name}</h1>
          {user.bio ? <p className="muted">{user.bio}</p> : null}
          <p className="muted">joined {new Date(user.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
      {!viewer.isMe ? (
        <div className="row">
          {viewer.isFollowing ? (
            <button
              type="button"
              className="secondary"
              onClick={() => unfollow.mutate({ userId: id })}
            >
              Unfollow
            </button>
          ) : (
            <button type="button" onClick={() => follow.mutate({ userId: id })}>
              Follow
            </button>
          )}
          {viewer.isFollowedBy ? (
            <span className="muted">follows you{viewer.isFollowing ? " · friends ✓" : ""}</span>
          ) : null}
        </div>
      ) : null}
      {err ? <p className="error">{describeError(err)}</p> : null}
      <ul className="stats">
        <li>
          <strong>{stats.habitsTracked}</strong> habits
        </li>
        <li>
          <strong>{stats.totalCheckIns}</strong> check-ins
        </li>
        <li>
          <strong>{stats.longestStreak}</strong> longest streak
        </li>
        <li>
          <strong>{stats.followers}</strong> followers
        </li>
        <li>
          <strong>{stats.following}</strong> following
        </li>
      </ul>
      {stats.currentStreaks.length > 0 ? (
        <div className="card">
          <h3>Current streaks</h3>
          <ul>
            {stats.currentStreaks.map((s) => (
              <li key={s.habitId}>
                🔥 {s.currentStreak} — {s.habitName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
