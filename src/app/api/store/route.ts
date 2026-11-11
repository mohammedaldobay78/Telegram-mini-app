import type { Settings } from "@/server/config/settings";
import { createUserRoute, json } from "@/server/http/route";
import { getUpgradeLevels } from "@/server/services/users";
import {
  UPGRADE_KINDS,
  consumableDurationSeconds,
  consumablePrice,
  isPaybackHealthy,
  maxLevel,
  upgradeCost,
  upgradeEffectLabel,
  upgradePaybackHours,
  workerOutputPerHour,
  workerRentPrice,
  WORKER_HOURS,
} from "@/server/economy/store";
import { coinPacks } from "@/server/services/stars";

const TITLES: Record<string, string> = {
  tap_power: "Tap Power",
  energy_cap: "Energy Cap",
  regen: "Faster Regen",
  double_tap: "Double Tap (30 min)",
  full_energy: "Full Energy",
  auto_tap: "Auto Tap (15 min)",
};

function buildCatalog(settings: Settings, levels: Record<string, number>) {
  const upgrades = UPGRADE_KINDS.map((kind) => {
    const level = levels[kind] ?? 0;
    const max = maxLevel(settings.economy, kind);
    const maxed = level >= max;
    const cost = maxed ? 0 : upgradeCost(settings.economy, kind, level);
    const paybackHours = maxed ? 0 : upgradePaybackHours(settings.economy, kind, level);
    return {
      kind,
      title: TITLES[kind] ?? kind,
      level,
      maxLevel: max,
      maxed,
      cost,
      effect: upgradeEffectLabel(settings.economy, kind, Math.min(level + 1, max)),
      paybackHours: Math.round(paybackHours * 10) / 10,
      paybackHealthy: maxed ? true : isPaybackHealthy(settings.economy, kind, level),
    };
  });

  const consumables = (["double_tap", "full_energy", "auto_tap"] as const).map((kind) => ({
    kind,
    title: TITLES[kind] ?? kind,
    price: consumablePrice(settings.economy, kind),
    durationSeconds:
      kind === "full_energy" ? 0 : consumableDurationSeconds(settings.economy, kind),
  }));

  const workers = [1, 2, 3].map((tier) => ({
    tier,
    outputPerHour: workerOutputPerHour(settings.economy, tier as 1 | 2 | 3),
    rentPerHour: settings.economy.worker_rent_per_hour[tier - 1] ?? 0,
    bundles: WORKER_HOURS.map((hours) => ({
      hours,
      price: workerRentPrice(settings.economy, tier as 1 | 2 | 3, hours),
    })),
  }));

  return {
    upgrades,
    consumables,
    workers,
    adTicketPrice: settings.economy.extra_ad_slot_price,
    workerMaxOfflineHours: settings.economy.worker_max_offline_hours,
    packs: coinPacks(settings),
    exchangeRate: settings.economy.coins_per_star,
    flags: settings.flags,
  };
}

/** PLAN �?6, �?2.5, �?2.6: store catalogue computed from settings. */
export const GET = createUserRoute({ route: "store", limit: 60, windowSeconds: 60 }, async ({ db, user, settings }) => {
  const levels = await getUpgradeLevels(db, user.id);
  return json({
    ...buildCatalog(settings, levels as unknown as Record<string, number>),
    serverTime: new Date().toISOString(),
  });
});
