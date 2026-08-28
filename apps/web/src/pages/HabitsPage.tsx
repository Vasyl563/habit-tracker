import type { HabitDto, HabitVisibility, ScheduleType } from "@habit-tracker/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { orpc } from "../api/client.js";
import { describeError } from "../api/errors.js";
import { type MessageKey, type Translator, useI18n } from "../lib/i18n.js";
import { DAY_NAMES, scheduleLabel } from "../lib/ui.js";

const PAGE = 6;
const SORTS = ["createdAt", "name", "currentStreak", "totalCheckIns"] as const;
const SORT_LABELS: Record<(typeof SORTS)[number], MessageKey> = {
  createdAt: "sort.createdAt",
  name: "sort.name",
  currentStreak: "sort.currentStreak",
  totalCheckIns: "sort.totalCheckIns"
};

/**
 * The L8 list screen: offset pagination + filters + search + whitelisted sort,
 * all typed end to end. Mutations invalidate the list (the server bumped its
 * cache version; the client refetches).
 */
export function HabitsPage() {
  const queryClient = useQueryClient();
  const { locale, t, tp } = useI18n();
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [visibility, setVisibility] = useState<HabitVisibility | "">("");
  const [schedule, setSchedule] = useState<ScheduleType | "">("");
  const [sortBy, setSortBy] = useState<(typeof SORTS)[number]>("createdAt");
  const [message, setMessage] = useState<{ kind: "notice" | "error"; text: string } | null>(null);
  // controlled only to show the weekday picker when "weekly" is selected
  const [newSchedule, setNewSchedule] = useState<ScheduleType>("daily");

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
        setMessage({ kind: "notice", text: t("habits.created") });
        void invalidate();
      },
      onError: (e) => setMessage({ kind: "error", text: describeError(e, t) })
    })
  );
  const checkIn = useMutation(
    orpc.checkIns.create.mutationOptions({
      onSuccess: (r) => {
        setMessage({
          kind: "notice",
          text: r.streak.milestone
            ? t("habits.milestone", { m: r.streak.milestone, s: r.streak.current })
            : t("habits.checkedIn", { s: r.streak.current })
        });
        void invalidate();
      },
      onError: (e) => setMessage({ kind: "error", text: describeError(e, t) })
    })
  );
  const archive = useMutation(
    orpc.habits.archive.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (e) => setMessage({ kind: "error", text: describeError(e, t) })
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
    setNewSchedule("daily");
  }

  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("habits.title")}</h1>
          <p className="sub">
            {total === 0
              ? t("habits.subtitleEmpty")
              : t("habits.subtitle", { n: total, unit: tp(total, "unit.habit") })}
          </p>
        </div>
      </div>

      <details className="creator">
        <summary>➕ {t("habits.new")}</summary>
        <form className="stack" onSubmit={onCreate}>
          <div className="field-grid">
            <label>
              {t("habits.name")}
              <input
                name="name"
                placeholder={t("habits.namePlaceholder")}
                required
                maxLength={80}
              />
            </label>
            <label>
              <span>
                {t("habits.description")} <span className="muted">{t("habits.optional")}</span>
              </span>
              <input
                name="description"
                placeholder={t("habits.descriptionPlaceholder")}
                maxLength={500}
              />
            </label>
          </div>
          <div className="field-grid">
            <label>
              {t("habits.howOften")}
              <select
                name="schedule"
                value={newSchedule}
                onChange={(e) => setNewSchedule(e.target.value as ScheduleType)}
              >
                <option value="daily">{t("habits.daily")}</option>
                <option value="weekly">{t("habits.weekly")}</option>
              </select>
            </label>
            <label>
              {t("habits.visibility")}
              <select name="visibility" defaultValue="private">
                <option value="private">{t("habits.visPrivate")}</option>
                <option value="friends">{t("habits.visFriends")}</option>
                <option value="public">{t("habits.visPublic")}</option>
              </select>
            </label>
          </div>
          {newSchedule === "weekly" ? (
            <div className="field">
              {t("habits.whichDays")}
              <div className="row wrap">
                {DAY_NAMES[locale].map((d, i) => (
                  <label key={d} className="day-chip">
                    <input type="checkbox" name={`wd${i}`} /> {d}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <div className="row">
            <button type="submit" disabled={create.isPending}>
              {t("habits.create")}
            </button>
          </div>
        </form>
      </details>

      <div className="toolbar">
        <input
          className="search"
          placeholder={t("habits.searchPlaceholder")}
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
          <option value="">{t("habits.filterVisibilityAll")}</option>
          <option value="public">{t("habits.fPublic")}</option>
          <option value="friends">{t("habits.fFriends")}</option>
          <option value="private">{t("habits.fPrivate")}</option>
        </select>
        <select
          value={schedule}
          onChange={(e) => {
            setSchedule(e.target.value as ScheduleType | "");
            setOffset(0);
          }}
        >
          <option value="">{t("habits.filterScheduleAll")}</option>
          <option value="daily">{t("habits.fDaily")}</option>
          <option value="weekly">{t("habits.fWeekly")}</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as (typeof SORTS)[number])}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(SORT_LABELS[s])}
            </option>
          ))}
        </select>
      </div>

      {message ? <p className={`banner ${message.kind}`}>{message.text}</p> : null}
      {list.isError ? <p className="banner error">{describeError(list.error, t)}</p> : null}

      <ul className="grid">
        {items.map((h) => (
          <HabitCard
            key={h.id}
            habit={h}
            t={t}
            tp={tp}
            locale={locale}
            onCheckIn={() => checkIn.mutate({ habitId: h.id })}
            onArchive={() => archive.mutate({ id: h.id })}
            busy={checkIn.isPending}
          />
        ))}
      </ul>
      {!list.isLoading && items.length === 0 ? (
        <div className="empty">
          <span className="icon">🌱</span>
          {q || visibility || schedule ? t("habits.emptyFiltered") : t("habits.emptyNone")}
        </div>
      ) : null}

      {total > PAGE ? (
        <div className="pager">
          <button
            type="button"
            className="secondary small"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
          >
            {t("pager.prev")}
          </button>
          <span>
            {t("pager.of", {
              range: total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`,
              total
            })}
          </span>
          <button
            type="button"
            className="secondary small"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
          >
            {t("pager.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HabitCard({
  habit,
  t,
  tp,
  locale,
  onCheckIn,
  onArchive,
  busy
}: {
  habit: HabitDto;
  t: Translator;
  tp: (n: number, base: "unit.day" | "unit.habit") => string;
  locale: "uk" | "en";
  onCheckIn: () => void;
  onArchive: () => void;
  busy: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = habit.lastCheckInDate === today;
  return (
    <li className="card habit-card">
      <div className="row space">
        <strong>{habit.name}</strong>
        <span className={`tag tag-${habit.visibility}`}>{t(`tag.${habit.visibility}`)}</span>
      </div>
      {habit.description ? <p className="desc">{habit.description}</p> : null}
      <div className="habit-meta">
        <span title={t("card.scheduleTitle")}>
          📅 {scheduleLabel(habit.schedule, habit.weekdays, locale, t)}
        </span>
        <span className="streak" title={t("card.longestTitle", { n: habit.longestStreak })}>
          🔥 {habit.currentStreak}
          <span className="unit">{tp(habit.currentStreak, "unit.day")}</span>
        </span>
        <span title={t("card.checkInsTitle")}>✅ {habit.totalCheckIns}</span>
      </div>
      <footer>
        <button
          type="button"
          className={doneToday ? "done" : ""}
          onClick={onCheckIn}
          disabled={busy || doneToday}
        >
          {doneToday ? t("card.doneToday") : t("card.checkIn")}
        </button>
        <button type="button" className="link danger small" onClick={onArchive}>
          {t("card.archive")}
        </button>
      </footer>
    </li>
  );
}
