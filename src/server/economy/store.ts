import type { EconomySettings } from "@/server/config/settings";
import type { ConsumableKind, UpgradeKind, WorkerHours, WorkerTier } from "@/lib/types";
import { energyCap, regenSeconds } from "./energy";

export interface UpgradeLevels {
  tap_power: number;
  energy_cap: number;
  regen: number;
}

export const EMPTY_UPGRADES: UpgradeLevels = { tap_power: 0, energy_cap: 0, regen: 0 };

export function maxLevel(settings: EconomySettings, kind: UpgradeKind): number {
  switch (kind) {
    case "tap_power":
      return settings.tap_power_max_level;
    case "energy_cap":
      return settings.energy_cap_max_level;
    case "regen":
      return settings.regen_max_level;
  }
}

/**
 * `cost = base * growth^level`, where level is the current level (0-based).
 * Growth values are tuned to the 2–6 h payback rule; see ADR-0004.
 */
export function upgradeCost(settings: EconomySettings, kind: UpgradeKind, currentLevel: number): number {
  const curve = settings.store_costs[kind];
  return Math.round(curve.base * Math.pow(curve.growth, Math.max(0, currentLevel)));
}

export function tapReward(settings: EconomySettings, tapPowerLevel: number): number {
  return settings.tap_reward + settings.tap_power_step * Math.max(0, tapPowerLevel);
}

export function tapsPerHour(settings: EconomySettings, levels: UpgradeLevels): number {
  return 3600 / regenSeconds(settings, levels.regen);
}

export function baseCoinsPerHour(settings: EconomySettings, levels: UpgradeLevels): number {
  return Math.round(tapReward(settings, levels.tap_power) * tapsPerHour(settings, levels));
}

export function baseRateMultiplier(settings: EconomySettings, levels: UpgradeLevels): number {
  return baseCoinsPerHour(settings, levels) / (settings.tap_reward * (3600 / settings.regen_seconds));
}

export function maxedUpgrades(settings: EconomySettings): UpgradeLevels {
  return {
    tap_power: settings.tap_power_max_level,
    energy_cap: settings.energy_cap_max_level,
    regen: settings.regen_max_level,
  };
}

/** PLAN §2.5: a fully-maxed player may not exceed 3× the base rate. */
export function assertBaseRateCap(settings: EconomySettings): void {
  const multiplier = baseRateMultiplier(settings, maxedUpgrades(settings));
  if (multiplier > settings.base_rate_cap_multiplier + 1e-9) {
    throw new Error(
      `Store curve exceeds base-rate cap: ${multiplier.toFixed(2)}x > ${settings.base_rate_cap_multiplier}x`,
    );
  }
}

export function referenceMomentum(settings: EconomySettings): number {
  return settings.payback_reference_momentum;
}

export function upgradePaybackHours(
  settings: EconomySettings,
  kind: UpgradeKind,
  currentLevel: number,
): number {
  const cost = upgradeCost(settings, kind, currentLevel);
  const levels = { ...EMPTY_UPGRADES };
  const momentum = referenceMomentum(settings);

  if (kind === "tap_power") {
    const gainPerHour = settings.tap_power_step * tapsPerHour(settings, levels) * momentum;
    return cost / gainPerHour;
  }

  if (kind === "energy_cap") {
    // Energy cap buys extra taps per recharge cycle. One cycle's value:
    const gainPerCycle = settings.energy_cap_step * tapReward(settings, levels.tap_power) * momentum;
    return cost / gainPerCycle;
  }

  // Regen: percentage reduction of recharge time increases sustained taps/h.
  const currentSeconds = regenSeconds(settings, currentLevel);
  const nextSeconds = regenSeconds(settings, currentLevel + 1);
  const gainPerHour = (3600 / nextSeconds - 3600 / currentSeconds) * tapReward(settings, 0) * momentum;
  return gainPerHour > 0 ? cost / gainPerHour : Number.POSITIVE_INFINITY;
}

export function isPaybackHealthy(settings: EconomySettings, kind: UpgradeKind, currentLevel: number): boolean {
  const payback = upgradePaybackHours(settings, kind, currentLevel);
  return payback >= settings.payback_min_hours && payback <= settings.payback_max_hours;
}

export function upgradeEffectLabel(settings: EconomySettings, kind: UpgradeKind, nextLevel: number): string {
  switch (kind) {
    case "tap_power":
      return `+${settings.tap_power_step} coins / tap`;
    case "energy_cap":
      return `+${settings.energy_cap_step} energy cap (${energyCap(settings, nextLevel)})`;
    case "regen":
      return `-${Math.round(settings.regen_step_pct * 100)}% regen time (${regenSeconds(settings, nextLevel)}s)`;
  }
}

export function consumablePrice(settings: EconomySettings, kind: Exclude<ConsumableKind, "ad_ticket">): number {
  return settings.consumables[kind].price;
}

export function consumableDurationSeconds(
  settings: EconomySettings,
  kind: "double_tap" | "auto_tap",
): number {
  return settings.consumables[kind].duration_seconds ?? 0;
}

export function workerRentPrice(settings: EconomySettings, tier: WorkerTier, hours: WorkerHours): number {
  const perHour = settings.worker_rent_per_hour[tier - 1];
  if (perHour === undefined) throw new Error(`Unknown worker tier ${tier}`);
  return perHour * hours;
}

export function workerOutputPerHour(settings: EconomySettings, tier: WorkerTier): number {
  const output = settings.worker_output_per_hour[tier - 1];
  if (output === undefined) throw new Error(`Unknown worker tier ${tier}`);
  return output;
}

export const WORKER_HOURS: readonly WorkerHours[] = [1, 8, 24];
export const UPGRADE_KINDS: readonly UpgradeKind[] = ["tap_power", "energy_cap", "regen"];
