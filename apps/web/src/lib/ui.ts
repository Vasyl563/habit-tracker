import type { Locale, Translator } from "./i18n.js";

/** Tiny presentation helpers shared by the pages — no data logic here. */

export const DAY_NAMES: Record<Locale, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  uk: ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]
};

const DATE_LOCALE: Record<Locale, string> = { uk: "uk-UA", en: "en-GB" };

/** "Ada Lovelace" → "AL"; used when a user has no avatar image. */
export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** Stable pastel-ish color per name so fallback avatars are distinguishable. */
export function colorFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 45%)`;
}

/** Check-in date (YYYY-MM-DD) → "Сьогодні" / "Вчора" / "25 сер." per locale. */
export function humanDate(isoDate: string, locale: Locale, t: Translator): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  if (isoDate === todayIso) return t("date.today");
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (isoDate === yesterday) return t("date.yesterday");
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(DATE_LOCALE[locale], {
    month: "short",
    day: "numeric"
  });
}

/** Month + year for profile pages, in the active locale. */
export function monthYear(isoDateTime: string, locale: Locale): string {
  return new Date(isoDateTime).toLocaleDateString(DATE_LOCALE[locale], {
    month: "long",
    year: "numeric"
  });
}

/** Full timestamp for notifications/payments, in the active locale. */
export function dateTime(isoDateTime: string, locale: Locale): string {
  return new Date(isoDateTime).toLocaleString(DATE_LOCALE[locale]);
}

/** "daily" | weekly weekdays [1,3,5] → "Щодня" | "Пн, Ср, Пт" per locale. */
export function scheduleLabel(
  schedule: "daily" | "weekly",
  weekdays: number[] | null,
  locale: Locale,
  t: Translator
): string {
  if (schedule === "daily") return t("schedule.everyDay");
  const names = DAY_NAMES[locale];
  const days = (weekdays ?? []).map((d) => names[d]).filter(Boolean);
  return days.length > 0 ? days.join(", ") : t("habits.fWeekly");
}
