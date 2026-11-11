import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/server/config/settings";
import {
  giftCatalog,
  giftCostUsdMicro,
  giftPrice,
  isGiftTier,
  isGiftUnlocked,
  minimumPackStars,
  packArbitrage,
} from "@/server/economy/pricing";

const economy = DEFAULT_SETTINGS.economy;
const payouts = DEFAULT_SETTINGS.payouts;

describe("economics of packs and gifts", () => {
  it("enforces the 1.2x pack arbitrage rule", () => {
    // 100,000 coins / 20,000 = 5 Stars of value, minimum 6 Stars.
    expect(minimumPackStars(economy, 100_000)).toBe(6);
    expect(packArbitrage(economy, { coins: 100_000, stars: 6 })).toMatchObject({
      minimumStars: 6,
      valid: true,
      marginStars: 0,
    });
    expect(packArbitrage(economy, { coins: 100_000, stars: 5 }).valid).toBe(false);
  });

  it("keeps every default coin pack non-arbitrageable", () => {
    for (const pack of economy.coin_packs) {
      expect(packArbitrage(economy, pack).valid, pack.id).toBe(true);
    }
  });

  it("prices gifts at the documented exchange rate", () => {
    expect(giftPrice(payouts, "starter")).toEqual({ coins: 300_000, stars: 15 });
    expect(giftPrice(payouts, "standard")).toEqual({ coins: 500_000, stars: 25 });
    expect(giftPrice(payouts, "premium")).toEqual({ coins: 1_000_000, stars: 50 });
    // 15 Stars at $0.02 per Star.
    expect(giftCostUsdMicro(payouts, 15)).toBe(300_000);
  });

  it("unlocks gift tiers from delivery count and active days", () => {
    expect(isGiftUnlocked(payouts, "starter", { deliveredCount: 0, activeDays: 0 })).toBe(true);
    expect(isGiftUnlocked(payouts, "standard", { deliveredCount: 0, activeDays: 99 })).toBe(false);
    expect(isGiftUnlocked(payouts, "standard", { deliveredCount: 1, activeDays: 0 })).toBe(true);
    expect(isGiftUnlocked(payouts, "premium", { deliveredCount: 9, activeDays: 29 })).toBe(false);
    expect(isGiftUnlocked(payouts, "premium", { deliveredCount: 9, activeDays: 30 })).toBe(true);
  });

  it("returns a catalogue with stable ids and copy", () => {
    const catalog = giftCatalog(payouts, { deliveredCount: 0, activeDays: 0 });
    expect(catalog.map((gift) => gift.id)).toEqual(["starter", "standard", "premium"]);
    expect(catalog.every((gift) => gift.coins > 0 && gift.stars > 0)).toBe(true);
    expect(catalog[1]?.unlocked).toBe(false);
  });

  it("validates gift tier ids", () => {
    expect(isGiftTier("starter")).toBe(true);
    expect(isGiftTier("diamond")).toBe(false);
  });
});
