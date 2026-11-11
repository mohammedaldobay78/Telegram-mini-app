import type { Activity, MomentumComponents } from "@/lib/types";
import type { MomentumSettings } from "@/server/config/settings";

export interface MomentumInput {
  settings: MomentumSettings;
  /** Rows for the last 7 days, including today when present. */
  activity: Activity[];
  /** YYYY-MM-DD in UTC. */
  today: string;
  streakDays: number;
  dailyQuestSetComplete: boolean;
  weeklyQuestComplete: boolean;
  activeReferrals: number;
}

const DAY_MS = 86_400_000;

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * PLAN §2.3. Pure and deterministic: the same inputs always produce the same
 * multiplier. The client never supplies `M`.
 */
export function computeMomentum(input: MomentumInput): MomentumComponents {
  const { settings, activity, today, streakDays, dailyQuestSetComplete, weeklyQuestComplete, activeReferrals } =
    input;

  const byDate = new Map(activity.map((row) => [row.date, row]));
  const todayRow = byDate.get(today);

  const base = settings.base;

  const streak = Math.min(Math.max(streakDays, 0) * settings.streak_per_day, settings.streak_cap);

  const activeMinutes = Math.floor((todayRow?.secondsActive ?? 0) / 60);
  let duration = 0;
  for (let index = 0; index < settings.duration_thresholds_min.length; index += 1) {
    const threshold = settings.duration_thresholds_min[index];
    const bonus = settings.duration_tiers[index];
    if (threshold !== undefined && bonus !== undefined && activeMinutes >= threshold) {
      duration = bonus;
    }
  }

  const dailyQuests = dailyQuestSetComplete ? settings.daily_quests : 0;
  const weeklyQuests = weeklyQuestComplete ? settings.weekly_quests : 0;
  const ads = (todayRow?.adsWatched ?? 0) >= settings.ads_threshold ? settings.ads_bonus : 0;
  const referrals = Math.min(Math.max(activeReferrals, 0) * settings.referral_bonus, settings.referral_cap);

  // A missed day is a day in the previous six with no play activity.
  let missedDays = 0;
  for (let offset = 1; offset <= 6; offset += 1) {
    const key = addDays(today, -offset);
    const row = byDate.get(key);
    if (!row || (row.taps === 0 && row.secondsActive === 0)) missedDays += 1;
  }
  const penalty = -(missedDays * settings.absence_penalty);

  const total = clamp(base + streak + duration + dailyQuests + weeklyQuests + ads + referrals + penalty, settings.min, settings.max);

  return {
    base: round2(base),
    streak: round2(streak),
    duration: round2(duration),
    dailyQuests: round2(dailyQuests),
    weeklyQuests: round2(weeklyQuests),
    ads: round2(ads),
    referrals: round2(referrals),
    penalty: round2(penalty),
    total: round2(total),
  };
}

/** The daily duration bonus is zeroed for macro-flagged users (PLAN §10.3). */
export function applyMacroPenalty(components: MomentumComponents, settings: MomentumSettings): MomentumComponents {
  if (components.duration === 0) return components;
  const total = clamp(components.total - components.duration, settings.min, settings.max);
  return { ...components, duration: 0, total: round2(total) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
