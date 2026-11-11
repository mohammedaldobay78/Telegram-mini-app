import { DEFAULT_SETTINGS } from "@/server/config/settings";
import { computeMomentum } from "@/server/economy/momentum";
import {
  assertBaseRateCap,
  baseCoinsPerHour,
  isPaybackHealthy,
  tapReward,
  upgradeCost,
  upgradePaybackHours,
  UPGRADE_KINDS,
} from "@/server/economy/store";
import type { Activity } from "@/lib/types";

/**
 * PLAN �?11.6 economy gate.
 *
 * Runs the four personas from PLAN �?2.4 for 365 simulated days using the real
 * momentum and pricing modules. The build fails if any persona misses its hour
 * band or if its 30-day margin drops below 1.5x.
 *
 * Run with `pnpm simulate`. Exit code 1 means the simulator gate failed.
 */

const DAYS = 365;
const TARGET_COINS = 300_000;
const START_DATE = "2026-01-01";

interface Persona {
  id: string;
  label: string;
  /** Consecutive days played, then the rest of the week is skipped. */
  playDaysPerWeek: number;
  minutesPerDay: number;
  adsPerDay: number;
  activeReferrals: number;
  completesDailyQuests: boolean;
  completesWeeklyQuest: boolean;
  expectedHours: readonly [number, number];
  expectedM: readonly [number, number];
}

const PERSONAS: readonly Persona[] = [
  {
    id: "lazy",
    label: "Lazy",
    playDaysPerWeek: 3,
    minutesPerDay: 30,
    adsPerDay: 2,
    activeReferrals: 0,
    completesDailyQuests: false,
    completesWeeklyQuest: false,
    expectedHours: [500, 750],
    expectedM: [0.8, 1.0],
  },
  {
    id: "mid",
    label: "Mid active",
    playDaysPerWeek: 7,
    minutesPerDay: 60,
    adsPerDay: 8,
    activeReferrals: 0,
    completesDailyQuests: true,
    completesWeeklyQuest: true,
    expectedHours: [180, 220],
    expectedM: [3.0, 3.4],
  },
  {
    id: "active",
    label: "Active",
    playDaysPerWeek: 7,
    minutesPerDay: 150,
    adsPerDay: 12,
    activeReferrals: 1,
    completesDailyQuests: true,
    completesWeeklyQuest: true,
    expectedHours: [110, 150],
    expectedM: [4.0, 4.5],
  },
  {
    id: "very_active",
    label: "Very active",
    playDaysPerWeek: 7,
    minutesPerDay: 240,
    adsPerDay: 30,
    activeReferrals: 6,
    completesDailyQuests: true,
    completesWeeklyQuest: true,
    expectedHours: [85, 100],
    expectedM: [5.8, 6.3],
  },
];

interface PersonaResult {
  persona: Persona;
  coinsPerHour: number;
  hoursToTarget: number;
  averageM: number;
  peakM: number;
  margin30d: number;
  totalTaps: number;
  totalCoins: number;
  totalHours: number;
}

function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function simulatePersona(persona: Persona): PersonaResult {
  const settings = DEFAULT_SETTINGS;
  const economy = settings.economy;
  const momentumSettings = settings.momentum;
  const perTap = tapReward(economy, 0);

  let activity: Activity[] = [];
  let streakDays = 0;
  let totalTaps = 0;
  let totalSeconds = 0;
  let totalTapCoins = 0;
  let mSum = 0;
  let playedDays = 0;
  let peakM = 0;

  for (let day = 0; day < DAYS; day += 1) {
    const dayKey = addDays(START_DATE, day);
    const plays = day % 7 < persona.playDaysPerWeek;

    if (plays) {
      streakDays += 1;
      const secondsActive = persona.minutesPerDay * 60;
      // 50 taps/h at the base 60 s regen.
      const taps = Math.round((3600 / economy.regen_seconds) * (persona.minutesPerDay / 60));

      activity = [
        ...activity,
        {
          date: dayKey,
          taps,
          adsWatched: persona.adsPerDay,
          secondsActive,
          questsDone: persona.completesDailyQuests ? economy.daily_quests.length : 0,
          coinsEarned: taps * perTap,
          purchases: 0,
          workersRented: 0,
        },
      ];
    } else {
      streakDays = 0;
      activity = [
        ...activity,
        {
          date: dayKey,
          taps: 0,
          adsWatched: 0,
          secondsActive: 0,
          questsDone: 0,
          coinsEarned: 0,
          purchases: 0,
          workersRented: 0,
        },
      ];
    }

    const window = activity.slice(-7);
    const weeklyComplete =
      persona.completesWeeklyQuest && plays && streakDays >= 7;

    const momentum = computeMomentum({
      settings: momentumSettings,
      activity: window,
      today: dayKey,
      streakDays,
      dailyQuestSetComplete: persona.completesDailyQuests && plays,
      weeklyQuestComplete: weeklyComplete,
      activeReferrals: persona.activeReferrals,
    });

    if (plays) {
      const taps = Math.round((3600 / economy.regen_seconds) * (persona.minutesPerDay / 60));
      totalTaps += taps;
      totalSeconds += persona.minutesPerDay * 60;
      totalTapCoins += taps * perTap * momentum.total;
      playedDays += 1;
      mSum += momentum.total;
      peakM = Math.max(peakM, momentum.total);
    }

    activity = activity.slice(-7);
  }

  const totalHours = totalSeconds / 3600;
  const coinsPerHour = totalHours > 0 ? totalTapCoins / totalHours : 0;
  const hoursToTarget = coinsPerHour > 0 ? TARGET_COINS / coinsPerHour : Number.POSITIVE_INFINITY;

  // 30-day margin: ad revenue per hour divided by the cost of the coins minted
  // per hour (1 coin = $0.000001 = 1 micro-dollar, PLAN �?2.11).
  const adsPerHour = persona.minutesPerDay > 0 ? persona.adsPerDay / (persona.minutesPerDay / 60) : 0;
  const revenueMicroPerHour = adsPerHour * economy.ad_revenue_micro;
  const margin30d = coinsPerHour > 0 ? revenueMicroPerHour / coinsPerHour : Number.POSITIVE_INFINITY;

  return {
    persona,
    coinsPerHour,
    hoursToTarget,
    averageM: mSum / Math.max(1, playedDays),
    peakM,
    margin30d,
    totalTaps,
    totalCoins: totalTapCoins,
    totalHours,
  };
}

function checkStore(): string[] {
  const settings = DEFAULT_SETTINGS;
  const issues: string[] = [];

  try {
    assertBaseRateCap(settings.economy);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  for (const kind of UPGRADE_KINDS) {
    const levels =
      kind === "tap_power"
        ? settings.economy.tap_power_max_level
        : kind === "energy_cap"
          ? settings.economy.energy_cap_max_level
          : settings.economy.regen_max_level;
    for (let level = 0; level < levels; level += 1) {
      const cost = upgradeCost(settings.economy, kind, level);
      const payback = upgradePaybackHours(settings.economy, kind, level);
      if (!isPaybackHealthy(settings.economy, kind, level)) {
        issues.push(
          `${kind} level ${level} payback ${payback.toFixed(1)} h is outside ` +
            `${settings.economy.payback_min_hours}�?${settings.economy.payback_max_hours} h (cost ${cost})`,
        );
      }
    }
  }

  // The base rate cap protects PLAN �?2.4 timings.
  const maxed = baseCoinsPerHour(settings.economy, {
    tap_power: settings.economy.tap_power_max_level,
    energy_cap: settings.economy.energy_cap_max_level,
    regen: settings.economy.regen_max_level,
  });
  const base = settings.economy.tap_reward * (3600 / settings.economy.regen_seconds);
  if (maxed > base * settings.economy.base_rate_cap_multiplier + 1) {
    issues.push(`Maxed base rate ${maxed}/h exceeds ${settings.economy.base_rate_cap_multiplier}x base ${base}/h`);
  }

  return issues;
}

function main(): number {
  const results = PERSONAS.map(simulatePersona);
  const issues: string[] = [];

  console.log("PLAN �?11.6 economy simulator");
  console.log(`momentum max ${DEFAULT_SETTINGS.momentum.max}, reference M ${DEFAULT_SETTINGS.economy.payback_reference_momentum}`);
  console.log("");
  console.log(
    ["persona", "avg M", "coins/h", "hours to 300k", "30d margin", "target hours"].join("\t"),
  );

  for (const result of results) {
    const { persona } = result;
    console.log(
      [
        persona.label,
        result.averageM.toFixed(2),
        Math.round(result.coinsPerHour).toString(),
        result.hoursToTarget.toFixed(0),
        `${result.margin30d.toFixed(2)}x`,
        `${persona.expectedHours[0]}�?${persona.expectedHours[1]}`,
      ].join("\t"),
    );

    const [minHours, maxHours] = persona.expectedHours;
    if (result.hoursToTarget < minHours || result.hoursToTarget > maxHours) {
      issues.push(
        `${persona.label}: ${result.hoursToTarget.toFixed(0)} h outside [${minHours}, ${maxHours}]`,
      );
    }
    if (result.margin30d < 1.5) {
      issues.push(`${persona.label}: 30-day margin ${result.margin30d.toFixed(2)}x is below 1.5x`);
    }
    if (result.averageM < 0.8 - 1e-9 || result.averageM > 6.3 + 1e-9) {
      issues.push(`${persona.label}: average M ${result.averageM.toFixed(2)} is outside [0.8, 6.3]`);
    }
  }

  console.log("");
  const storeIssues = checkStore();
  if (storeIssues.length > 0) {
    console.error("Store payback checks failed:");
    for (const issue of storeIssues) console.error(`  - ${issue}`);
    issues.push(...storeIssues);
  } else {
    console.log("Store payback checks: all upgrade levels are inside the 2�?6 h rule.");
  }

  if (issues.length > 0) {
    console.error("");
    console.error(`SIMULATOR FAILED with ${issues.length} issue(s):`);
    for (const issue of issues) console.error(`  - ${issue}`);
    return 1;
  }

  console.log("");
  console.log("SIMULATOR PASSED: all personas and store paybacks are inside PLAN �?11.6.");
  return 0;
}

process.exit(main());
