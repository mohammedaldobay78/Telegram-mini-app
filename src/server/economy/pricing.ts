import { z } from "zod";
import type { Gift } from "@/lib/types";
import type { EconomySettings, PayoutsSettings } from "@/server/config/settings";

export const GIFT_TIERS = ["starter", "standard", "premium"] as const;
export type GiftTier = (typeof GIFT_TIERS)[number];

export const giftTierSchema = z.enum(GIFT_TIERS);

export const GIFT_COPY: Record<GiftTier, { title: string; note: string }> = {
  starter: { title: "Starter gift", note: "Available from day 1" },
  standard: { title: "Standard gift", note: "Unlocks after your first delivery" },
  premium: { title: "Premium gift", note: "Unlocks after 30 days of activity" },
};

export interface GiftUnlockState {
  deliveredCount: number;
  activeDays: number;
}

export function giftPrice(settings: PayoutsSettings, tier: GiftTier): { coins: number; stars: number } {
  return { coins: settings.gifts[tier], stars: settings.gift_prices_stars[tier] };
}

export function isGiftUnlocked(settings: PayoutsSettings, tier: GiftTier, state: GiftUnlockState): boolean {
  switch (tier) {
    case "starter":
      return true;
    case "standard":
      return state.deliveredCount >= 1;
    case "premium":
      return state.activeDays >= 30;
  }
}

export function giftCatalog(settings: PayoutsSettings, state: GiftUnlockState): Gift[] {
  return GIFT_TIERS.map((tier) => {
    const price = giftPrice(settings, tier);
    return {
      id: tier,
      title: GIFT_COPY[tier].title,
      stars: price.stars,
      coins: price.coins,
      unlocked: isGiftUnlocked(settings, tier, state),
      note: GIFT_COPY[tier].note,
    };
  });
}

export function isGiftTier(value: string): value is GiftTier {
  return (GIFT_TIERS as readonly string[]).includes(value);
}

export function giftCostUsdMicro(settings: PayoutsSettings, stars: number): number {
  return stars * settings.star_value_micro;
}

/**
 * PLAN §2.10: pack_cost_stars >= (coins / coins_per_star) * 1.2.
 * Rounded up because Stars are integers.
 */
export function minimumPackStars(settings: EconomySettings, coins: number): number {
  return Math.ceil((coins / settings.coins_per_star) * settings.pack_margin);
}

export function packArbitrage(settings: EconomySettings, pack: { coins: number; stars: number }): {
  minimumStars: number;
  valid: boolean;
  marginStars: number;
} {
  const minimumStars = minimumPackStars(settings, pack.coins);
  return {
    minimumStars,
    valid: pack.stars >= minimumStars,
    marginStars: pack.stars - minimumStars,
  };
}

export function assertPackArbitrage(settings: EconomySettings, pack: { coins: number; stars: number }): void {
  const result = packArbitrage(settings, pack);
  if (!result.valid) {
    throw new Error(
      `Coin pack violates the arbitrage rule: ${pack.stars} Stars < minimum ${result.minimumStars} Stars`,
    );
  }
}

/** Value of coins in Stars, used by wallet copy. */
export function coinsToStars(settings: EconomySettings, coins: number): number {
  return coins / settings.coins_per_star;
}
