import type { HabitDto, HabitVisibility, ScheduleType } from "@habit-tracker/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";

const PAGE = 6;
const SORTS = ["createdAt", "name", "currentStreak", "totalCheckIns"] as const;

/**
 * The L8 list screen: offset pagination + filters + search + whitelisted sort,
 * all typed end to end. Mutations invalidate the list (the server bumped its
 * cache version; the client refetches).
 */
export function HabitsPage() {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [visibility, setVisibility] = useState<HabitVisibility | "">("");
  const [schedule, setSchedule] = useState<ScheduleType | "">("");
  const [sortBy, setSortBy] = useState<(typeof SORTS)[number]>("createdAt");
  const [message, setMessage] = useState<string | null>(null);

  const input = {
    limit: PAGE,
    offset,
    q: q.trim() || undefined,
    visibility: visibility || undefined,
    schedule: schedule || undefined,
    sortBy,
    sortDir: "desc" as const,
    includeArchived: false
  };
  const list = useQuery(orpc.habits.list.queryOptions({ input, placeholderData: (prev) => prev }));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.habits.key() });

  const create = useMutation(
    orpc.habits.create.mutationOptions({
      onSuccess: () => {
        setMessage("Habit created");
        void invalidate();
      },
      onError: (e) => setMessage(describeError(e))
    })
  );
  const checkIn = useMutation(
    orpc.checkIns.create.mutationOptions({
      onSuccess: (r) => {
        setMessage(
          r.streak.milestone
            ? `🔥 ${r.streak.milestone}-day milestone! Streak ${r.streak.current}`
            : `Checked in — streak ${r.streak.current}`
        );
        void invalidate();
      },
      onError: (e) => setMessage(describeError(e))
    })
  );
  const archive = useMutation(
    orpc.habits.archive.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (e) => setMessage(describeError(e))
    })
  );

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const scheduleValue = String(f.get("schedule")) as ScheduleType;
    const weekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => f.get(`wd${d}`) === "on");
    create.mutate({
      name: String(f.get("name")),
      description: String(f.get("description") || "") || null,
      schedule: scheduleValue,
      weekdays: scheduleValue === "weekly" ? weekdays : null,
      visibility: String(f.get("visibility")) as HabitVisibility
    });
    e.currentTarget.reset();
  }

  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];

  return (
    <div className="stack">
      <h1>My habits</h1>

      <form className="card row wrap" onSubmit={onCreate}>
        <input name="name" placeholder="New habit, e.g. Read 20 pages" required maxLength={80} />
        <input name="description" placeholder="description (optional)" maxLength={500} />
        <select name="schedule" defaultValue="daily">
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>
        <span className="row" title="weekdays (for weekly)">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d, i) => (
            <label key={d} className="chip">
              <input type="checkbox" name={`wd${i}`} /> {d}
            </label>
          ))}
        </span>
        <select name="visibility" defaultValue="private">
          <option value="private">private</option>
          <option value="friends">friends</option>
          <option value="public">public</option>
        </select>
        <button type="submit" disabled={create.isPending}>
          Add
        </button>
      </form>

      <div className="row wrap">
        <input
          placeholder="search…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          value={visibility}
          onChange={(e) => {
            setVisibility(e.target.value as HabitVisibility | "");
            setOffset(0);
          }}
        >
          <option value="">any visibility</option>
          <option value="public">public</option>
          <option value="friends">friends</option>
          <option value="private">private</option>
        </select>
        <select
          value={schedule}
          onChange={(e) => {
            setSchedule(e.target.value as ScheduleType | "");
            setOffset(0);
          }}
        >
          <option value="">any schedule</option>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as (typeof SORTS)[number])}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              sort: {s}
            </option>
          ))}
        </select>
      </div>

      {message ? <p className="notice">{message}</p> : null}
      {list.isError ? <p className="error">{describeError(list.error)}</p> : null}

      <ul className="grid">
        {items.map((h) => (
          <HabitCard
            key={h.id}
            habit={h}
            onCheckIn={() => checkIn.mutate({ habitId: h.id })}
            onArchive={() => archive.mutate({ id: h.id })}
            busy={checkIn.isPending}
          />
        ))}
      </ul>
      {!list.isLoading && items.length === 0 ? <p className="muted">No habits match.</p> : null}

      <div className="row">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE))}
        >
          ← Prev
        </button>
        <span className="muted">
          {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`} of {total}
        </span>
        <button
          type="button"
          disabled={offset + PAGE >= total}
          onClick={() => setOffset(offset + PAGE)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function HabitCard({
  habit,
  onCheckIn,
  onArchive,
  busy
}: {
  habit: HabitDto;
  onCheckIn: () => void;
  onArchive: () => void;
  busy: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = habit.lastCheckInDate === today;
  return (
    <li className="card stack">
      <div className="row space">
        <strong>{habit.name}</strong>
        <span className={`tag tag-${habit.visibility}`}>{habit.visibility}</span>
      </div>
      {habit.description ? <p className="muted">{habit.description}</p> : null}
      <p className="muted">
        {habit.schedule === "daily" ? "every day" : `weekdays ${(habit.weekdays ?? []).join(",")}`}{" "}
        · 🔥 {habit.currentStreak} (best {habit.longestStreak}) · {habit.totalCheckIns} check-ins
      </p>
      <div className="row">
        <button type="button" onClick={onCheckIn} disabled={busy || doneToday}>
          {doneToday ? "Done today ✓" : "Check in today"}
        </button>
        <button type="button" className="link" onClick={onArchive}>
          archive
        </button>
      </div>
    </li>
  );
}
