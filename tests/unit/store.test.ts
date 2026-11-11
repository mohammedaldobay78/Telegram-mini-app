import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/server/config/settings";
import {
  assertBaseRateCap,
  baseCoinsPerHour,
  isPaybackHealthy,
  maxLevel,
  tapReward,
  upgradeCost,
  upgradePaybackHours,
  workerOutputPerHour,
  workerRentPrice,
  UPGRADE_KINDS,
} from "@/server/economy/store";

const economy = DEFAULT_SETTINGS.economy;

describe("store pricing", () => {
  it("raises costs geometrically from base", () => {
    expect(upgradeCost(economy, "tap_power", 0)).toBe(800);
    expect(upgradeCost(economy, "tap_power", 1)).toBe(Math.round(800 * 1.18));
    expect(upgradeCost(economy, "tap_power", 4)).toBe(Math.round(800 * 1.18 ** 4));
  });

  it("keeps every upgrade level inside the 2–6 h payback rule", () => {
    for (const kind of UPGRADE_KINDS) {
      const levels = maxLevel(economy, kind);
      expect(levels).toBeGreaterThan(0);
      for (let level = 0; level < levels; level += 1) {
        const payback = upgradePaybackHours(economy, kind, level);
        expect(payback, `${kind} level ${level}`).toBeGreaterThanOrEqual(economy.payback_min_hours);
        expect(payback, `${kind} level ${level}`).toBeLessThanOrEqual(economy.payback_max_hours);
        expect(isPaybackHealthy(economy, kind, level)).toBe(true);
      }
    }
  });

  it("adds the documented tap power per level", () => {
    expect(tapReward(economy, 0)).toBe(10);
    expect(tapReward(economy, 5)).toBe(20);
  });

  it("never exceeds 3x the base rate when fully maxed", () => {
    expect(() => assertBaseRateCap(economy)).not.toThrow();
    const base = economy.tap_reward * (3600 / economy.regen_seconds);
    const maxed = baseCoinsPerHour(economy, {
      tap_power: economy.tap_power_max_level,
      energy_cap: economy.energy_cap_max_level,
      regen: economy.regen_max_level,
    });
    expect(maxed).toBeLessThanOrEqual(base * economy.base_rate_cap_multiplier + 1);
  });

  it("prices workers below their output for every bundle", () => {
    for (const tier of [1, 2, 3] as const) {
      const output = workerOutputPerHour(economy, tier);
      for (const hours of [1, 8, 24] as const) {
        expect(workerRentPrice(economy, tier, hours)).toBeLessThan(output * hours);
      }
    }
    expect(workerOutputPerHour(economy, 1)).toBe(50);
    expect(workerRentPrice(economy, 3, 8)).toBe(2_240);
  });
});
