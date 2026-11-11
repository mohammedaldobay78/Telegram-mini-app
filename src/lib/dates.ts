const DAY_MS = 86_400_000;

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function yesterdayKey(key: string): string {
  return addDaysKey(key, -1);
}

export function lastNDays(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => addDaysKey(today, -index)).reverse();
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function nextUtcMidnight(date: Date): Date {
  const start = startOfUtcDay(date);
  return new Date(start.getTime() + DAY_MS);
}

/** ISO-8601 week key, e.g. 2026-W46. Used for the weekly quest chain. */
export function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}
