import type { IsoDate } from "./dates.js";
import { addDays, weekdayOf } from "./dates.js";

/**
 * Streak rules (Theme 05):
 *  - `daily`  → every calendar day is a scheduled day.
 *  - `weekly` → only the listed weekdays (0=Sun…6=Sat) are scheduled; other
 *               days neither count nor break a streak.
 *  - current streak counts backwards from `today`; if today is scheduled but
 *    not checked yet, the streak is still "alive" (grace until midnight).
 *  - longest streak is the longest run of consecutive scheduled days that
 *    were all checked in.
 *
 * Pure function — recomputed from the habit's check-in dates inside the same
 * transaction as the check-in write, so counters can never drift.
 */
export interface StreakSchedule {
  schedule: "daily" | "weekly";
  weekdays: number[] | null;
}

export interface Streaks {
  current: number;
  longest: number;
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365] as const;

export function isScheduledDay(date: IsoDate, { schedule, weekdays }: StreakSchedule): boolean {
  if (schedule === "daily") return true;
  if (!weekdays || weekdays.length === 0) return true;
  return weekdays.includes(weekdayOf(date));
}

export function computeStreaks(
  checkInDates: Iterable<IsoDate>,
  scheduleInfo: StreakSchedule,
  today: IsoDate
): Streaks {
  const dates = new Set(checkInDates);
  if (dates.size === 0) return { current: 0, longest: 0 };

  const sorted = [...dates].sort();
  const first = sorted[0] as IsoDate;
  const lastKnown = sorted[sorted.length - 1] as IsoDate;
  const end = lastKnown > today ? lastKnown : today;

  // longest: forward scan over every scheduled day between first check-in and today
  let longest = 0;
  let run = 0;
  for (let day = first; day <= end; day = addDays(day, 1)) {
    if (!isScheduledDay(day, scheduleInfo)) continue;
    if (dates.has(day)) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  // current: backward scan from today; today itself may still be pending
  let current = 0;
  let day = end;
  let graceUsed = false;
  while (day >= first) {
    if (isScheduledDay(day, scheduleInfo)) {
      if (dates.has(day)) {
        current += 1;
      } else if (day === today && !graceUsed) {
        graceUsed = true; // today not checked yet — don't break
      } else {
        break;
      }
    }
    day = addDays(day, -1);
  }

  return { current, longest };
}

/** The milestone crossed by moving from `before` to `after`, if any. */
export function crossedMilestone(before: number, after: number): number | null {
  for (const m of STREAK_MILESTONES) {
    if (before < m && after >= m) return m;
  }
  return null;
}
