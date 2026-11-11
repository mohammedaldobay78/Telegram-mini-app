import { getSettings } from "@/server/config/settings";
import { GIFT_TIERS, giftPrice } from "@/server/economy/pricing";
import { getMyStarBalance } from "@/server/telegram/api";
import { giftCatalog, resolveGiftId } from "@/server/telegram/gifts";

/**
 * PLAN �?9 / �?14: verify the live Telegram gift catalog before launch.
 *
 * - lists every gift returned by getAvailableGifts
 * - resolves each logical tier to a live gift id
 * - flags configured ids that no longer exist
 * - warns when the bot Stars balance is below three weeks of payouts
 */
async function main(): Promise<void> {
  const settings = await getSettings();
  const gifts = await giftCatalog(true);

  if (gifts.length === 0) {
    console.error("No gifts returned by getAvailableGifts");
    process.exit(1);
    return;
  }

  console.log("Available gifts:");
  for (const gift of gifts) {
    console.log(
      `  id=${gift.id} stars=${gift.star_count} remaining=${gift.remaining_count ?? "?"} total=${gift.total_count ?? "?"}`,
    );
  }

  const issues: string[] = [];
  const ids = new Set(gifts.map((gift) => gift.id));

  for (const tier of GIFT_TIERS) {
    const price = giftPrice(settings.payouts, tier);
    const configured = settings.payouts.gift_ids[tier];
    if (configured && !ids.has(configured)) {
      issues.push(`configured ${tier} gift id ${configured} is not in the live catalog`);
    }
    try {
      const resolved = await resolveGiftId(settings, tier);
      console.log(`${tier}: ${price.coins} coins / ${price.stars} Stars -> gift ${resolved}`);
    } catch (error) {
      issues.push(`${tier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const balance = await getMyStarBalance();
    const weekly = settings.payouts.weekly_cap_stars;
    const floor = weekly * 3;
    console.log(`Bot Stars balance: ${balance} (3-week floor at weekly cap: ${floor})`);
    if (balance < floor) {
      issues.push(`Stars balance ${balance} is below the 3-week floor ${floor}`);
    }
  } catch (error) {
    issues.push(`cannot read Stars balance: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (issues.length > 0) {
    console.error("");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
    return;
  }

  console.log("Gift catalog and Stars balance look healthy.");
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "gift_check_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
