import { describe, expect, it } from "vitest";
import type { Activity } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/server/config/settings";
import { applyMacroPenalty, computeMomentum } from "@/server/economy/momentum";

const momentumSettings = DEFAULT_SETTINGS.momentum;

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    date: "2026-01-10",
    taps: 100,
    adsWatched: 0,
    secondsActive: 0,
    questsDone: 0,
    coinsEarned: 0,
    purchases: 0,
    workersRented: 0,
    ...overrides,
  };
}

describe("computeMomentum", () => {
  it("sums every component deterministically", () => {
    const result = computeMomentum({
      settings: momentumSettings,
      activity: [activity({ secondsActive: 3_000, adsWatched: 10 })],
      today: "2026-01-10",
      streakDays: 5,
      dailyQuestSetComplete: true,
      weeklyQuestComplete: true,
      activeReferrals: 3,
    });

    expect(result).toMatchObject({
      base: 1,
      streak: 1,
      duration: 0.4,
      dailyQuests: 0.4,
      weeklyQuests: 0.4,
      ads: 0.4,
      referrals: 0.6,
      // Only today is present in the window, so six missed days apply.
      penalty: -1.8,
      total: 2.4,
    });
  });

  it("applies the duration tiers by active minutes", () => {
    const at = (minutes: number) =>
      computeMomentum({
        settings: momentumSettings,
        activity: [activity({ secondsActive: minutes * 60 })],
        today: "2026-01-10",
        streakDays: 1,
        dailyQuestSetComplete: false,
        weeklyQuestComplete: false,
        activeReferrals: 0,
      }).duration;

    expect(at(29)).toBe(0);
    expect(at(30)).toBe(0.4);
    expect(at(90)).toBe(0.8);
    expect(at(180)).toBe(1.2);
    expect(at(240)).toBe(1.7);
  });

  it("penalises missed days and floors at 0.8", () => {
    const result = computeMomentum({
      settings: momentumSettings,
      activity: [],
      today: "2026-01-10",
      streakDays: 0,
      dailyQuestSetComplete: false,
      weeklyQuestComplete: false,
      activeReferrals: 0,
    });

    expect(result.penalty).toBe(-1.8);
    expect(result.total).toBe(0.8);
  });

  it("caps referral momentum at the configured maximum", () => {
    const result = computeMomentum({
      settings: momentumSettings,
      activity: [activity({ secondsActive: 3_000 })],
      today: "2026-01-10",
      streakDays: 0,
      dailyQuestSetComplete: false,
      weeklyQuestComplete: false,
      activeReferrals: 50,
    });

    expect(result.referrals).toBe(1.2);
  });

  it("removes the duration bonus for macro-flagged taps", () => {
    // A full week of activity avoids the absence penalty floor, so the
    // duration bonus is the only component being removed.
    const week = Array.from({ length: 7 }, (_, index) =>
      activity({
        date: `2026-01-${String(4 + index).padStart(2, "0")}`,
        secondsActive: index === 6 ? 3_000 : 600,
      }),
    );

    const normal = computeMomentum({
      settings: momentumSettings,
      activity: week,
      today: "2026-01-10",
      streakDays: 2,
      dailyQuestSetComplete: false,
      weeklyQuestComplete: false,
      activeReferrals: 0,
    });
    const flagged = applyMacroPenalty(normal, momentumSettings);

    expect(normal.penalty).toBeCloseTo(0);
    expect(normal.duration).toBe(0.4);
    expect(flagged.duration).toBe(0);
    expect(flagged.total).toBe(normal.total - normal.duration);
  });
});
