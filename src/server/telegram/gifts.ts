import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { Settings } from "@/server/config/settings";
import type { GiftTier } from "@/server/economy/pricing";
import { giftPrice } from "@/server/economy/pricing";
import { getAvailableGifts, sendGift, type StarGift } from "./api";

const CACHE_MS = 10 * 60 * 1000;
let cache: { gifts: StarGift[]; expiresAt: number } | null = null;

/** PLAN §7.6: catalog from getAvailableGifts, cached for 10 minutes. */
export async function giftCatalog(force = false): Promise<StarGift[]> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.gifts;
  const gifts = await getAvailableGifts();
  cache = { gifts, expiresAt: Date.now() + CACHE_MS };
  return gifts;
}

export function clearGiftCache(): void {
  cache = null;
}

/**
 * Resolves the logical tier to a live Telegram gift id. Configured ids win;
 * otherwise the catalog is matched by Star value (never hardcoded).
 */
export async function resolveGiftId(settings: Settings, tier: GiftTier): Promise<string> {
  const configured = settings.payouts.gift_ids[tier];
  if (configured) return configured;

  const { stars } = giftPrice(settings.payouts, tier);
  const gifts = await giftCatalog();
  const exact = gifts
    .filter((gift) => gift.star_count === stars)
    .sort((a, b) => (b.remaining_count ?? 0) - (a.remaining_count ?? 0))[0];
  if (exact) return exact.id;

  const fallback = gifts.filter((gift) => gift.star_count >= stars).sort((a, b) => a.star_count - b.star_count)[0];
  if (fallback) return fallback.id;

  throw new AppError("UPSTREAM_ERROR", `No Telegram gift available at ${stars} Stars`, { retryable: true });
}

export async function deliverGift(input: {
  telegramId: number;
  giftId: string;
  text: string;
}): Promise<void> {
  const env = getEnv();
  if (!env.BOT_TOKEN) throw new AppError("CONFIG_ERROR", "BOT_TOKEN is not configured");
  await sendGift({ userId: input.telegramId, giftId: input.giftId, text: input.text });
}
