import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { DEFAULT_SETTINGS } from "@/server/config/settings";
import { computeEnergy, consumeEnergy, energyCap, fillEnergy, regenSeconds } from "@/server/economy/energy";

const economy = DEFAULT_SETTINGS.economy;

describe("energy", () => {
  it("grows the cap by 25 per level", () => {
    expect(energyCap(economy, 0)).toBe(50);
    expect(energyCap(economy, 4)).toBe(150);
    // Levels above the maximum are clamped.
    expect(energyCap(economy, 99)).toBe(150);
  });

  it("reduces regen time by 10% per level and never below 1 second", () => {
    expect(regenSeconds(economy, 0)).toBe(72);
    expect(regenSeconds(economy, 1)).toBe(65);
    expect(regenSeconds(economy, 3)).toBe(52);
    expect(regenSeconds(economy, 99)).toBe(52);
  });

  it("credits energy from the server clock", () => {
    const now = new Date("2026-01-10T12:10:00.000Z");
    const snapshot = computeEnergy(
      economy,
      { energyCapLevel: 0, regenLevel: 0 },
      10,
      new Date("2026-01-10T12:00:00.000Z"),
      now,
    );

    // 10 minutes at one energy per 72 s -> 8 energy.
    expect(snapshot.energy).toBe(18);
    expect(snapshot.cap).toBe(50);
    expect(snapshot.nextRegenInSeconds).toBe(48);
  });

  it("stops at the cap and reports no next regen", () => {
    const now = new Date("2026-01-10T12:10:00.000Z");
    const snapshot = computeEnergy(
      economy,
      { energyCapLevel: 0, regenLevel: 0 },
      45,
      new Date("2026-01-10T12:00:00.000Z"),
      now,
    );
    expect(snapshot.energy).toBe(50);
    expect(snapshot.nextRegenInSeconds).toBe(0);
  });

  it("consumes energy and rejects an overdraw", () => {
    const filled = fillEnergy(economy, { energyCapLevel: 0, regenLevel: 0 }, new Date());
    const after = consumeEnergy(filled, 10);
    expect(after.energy).toBe(40);

    expect(() => consumeEnergy(after, 41)).toThrow(AppError);
    expect(() => consumeEnergy(after, 0)).toThrow(AppError);
  });
});
