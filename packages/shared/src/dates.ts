/** Calendar-day helpers. Dates are `YYYY-MM-DD` strings; math is done in UTC. */

export type IsoDate = string;

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s: IsoDate): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function addDays(s: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(s: IsoDate): number {
  return parseIsoDate(s).getUTCDay();
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseIsoDate(s).getTime());
}
