import { z } from "zod";
import type { Database } from "@/db/client";
import { getDb } from "@/db/client";
import { adminAudit, settings as settingsTable } from "@/db/schema";
import { AppError } from "@/lib/errors";

/**
 * Every economy number lives here and in the `settings` table (PLAN §4.4,
 * §12). Application code must not hardcode an economy constant.
 */

const nonNegativeInt = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();

export const storeCostSchema = z.object({
  base: positiveInt,
  growth: z.number().min(1).max(4),
});

export const consumableSchema = z.object({
  price: positiveInt,
  duration_seconds: positiveInt.optional(),
});

export const questDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  metric: z.enum(["taps", "ads", "coins", "purchases", "workers"]),
  target: positiveInt,
  reward: positiveInt,
});

export const coinPackSchema = z.object({
  id: z.string().min(1),
  coins: positiveInt,
  stars: positiveInt,
});

export const economySettingsSchema = z.object({
  coins_per_star: positiveInt,
  signup_coins: positiveInt,
  daily_gift: z.tuple([positiveInt, positiveInt, positiveInt]),
  tap_reward: positiveInt,
  energy_cap: positiveInt,
  regen_seconds: positiveInt,
  ad_reward: positiveInt,
  free_ads_per_day: nonNegativeInt,
  extra_ad_slot_price: positiveInt,
  max_ads_per_day: positiveInt,
  ad_cooldown_seconds: positiveInt,
  ad_revenue_micro: nonNegativeInt,
  worker_output_per_hour: z.tuple([positiveInt, positiveInt, positiveInt]),
  worker_rent_per_hour: z.tuple([positiveInt, positiveInt, positiveInt]),
  worker_max_offline_hours: positiveInt,
  referral_rate: z.number().min(0).max(1),
  referral_daily_cap: positiveInt,
  referral_max_active: positiveInt,
  max_daily_coins: positiveInt,
  tap_power_step: positiveInt,
  tap_power_max_level: nonNegativeInt,
  energy_cap_step: positiveInt,
  energy_cap_max_level: nonNegativeInt,
  regen_step_pct: z.number().min(0).max(0.9),
  regen_max_level: nonNegativeInt,
  store_costs: z.object({
    tap_power: storeCostSchema,
    energy_cap: storeCostSchema,
    regen: storeCostSchema,
  }),
  consumables: z.object({
    double_tap: consumableSchema,
    full_energy: consumableSchema,
    auto_tap: consumableSchema,
  }),
  daily_quests: z.array(questDefinitionSchema).min(1).max(10),
  weekly_quest_reward: positiveInt,
  coin_packs: z.array(coinPackSchema).default([]),
  pack_margin: z.number().min(1).max(2).default(1.2),
  base_rate_cap_multiplier: z.number().min(1).max(10),
  payback_reference_momentum: z.number().positive(),
  payback_min_hours: z.number().positive(),
  payback_max_hours: z.number().positive(),
});

export const momentumSettingsSchema = z.object({
  base: z.number(),
  streak_per_day: z.number().min(0),
  streak_cap: z.number().min(0),
  duration_tiers: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  duration_thresholds_min: z.tuple([positiveInt, positiveInt, positiveInt, positiveInt]),
  daily_quests: z.number(),
  weekly_quests: z.number(),
  ads_bonus: z.number(),
  ads_threshold: positiveInt,
  referral_bonus: z.number(),
  referral_cap: z.number(),
  absence_penalty: z.number(),
  min: z.number(),
  max: z.number(),
});

export const payoutsSettingsSchema = z.object({
  gifts: z.object({
    starter: positiveInt,
    standard: positiveInt,
    premium: positiveInt,
  }),
  gift_prices_stars: z.object({
    starter: positiveInt,
    standard: positiveInt,
    premium: positiveInt,
  }),
  gift_ids: z
    .object({
      starter: z.string().default(""),
      standard: z.string().default(""),
      premium: z.string().default(""),
    })
    .default({ starter: "", standard: "", premium: "" }),
  min_account_age_days: nonNegativeInt,
  min_taps: nonNegativeInt,
  min_ad_views: nonNegativeInt,
  min_revenue_micro: nonNegativeInt,
  revenue_multiplier: z.number().positive(),
  weekly_cap_stars: positiveInt,
  monthly_cap_stars: positiveInt,
  global_budget_ratio: z.number().min(0).max(1),
  star_value_micro: positiveInt,
  referral_payout_delay_hours: nonNegativeInt,
  referral_qualification: z.object({
    min_age_days: nonNegativeInt,
    min_taps: nonNegativeInt,
    min_ad_views: nonNegativeInt,
    min_revenue_micro: nonNegativeInt,
  }),
});

export const flagsSettingsSchema = z.object({
  ads: z.boolean(),
  payouts: z.boolean(),
  store: z.boolean(),
});

export const securitySettingsSchema = z.object({
  max_taps_per_request: positiveInt,
  min_tap_interval_ms: positiveInt,
  tap_cv_threshold: z.number().min(0).max(1),
  heartbeat_window_seconds: positiveInt,
  max_daily_minutes: positiveInt,
  auth_max_age_seconds: positiveInt,
  initdata_cache_seconds: positiveInt,
  initdata_cache_size: positiveInt,
  reconcile_drift_threshold: nonNegativeInt,
  webhook_max_age_seconds: positiveInt,
  admin_callback_max_age_seconds: positiveInt,
});

export const settingsSchema = z.object({
  economy: economySettingsSchema,
  momentum: momentumSettingsSchema,
  payouts: payoutsSettingsSchema,
  flags: flagsSettingsSchema,
  security: securitySettingsSchema,
});

export type Settings = z.infer<typeof settingsSchema>;
export type EconomySettings = Settings["economy"];
export type MomentumSettings = Settings["momentum"];
export type PayoutsSettings = Settings["payouts"];
export type FlagsSettings = Settings["flags"];
export type SecuritySettings = Settings["security"];
export type QuestDefinition = z.infer<typeof questDefinitionSchema>;

export const SETTINGS_SECTIONS = ["economy", "momentum", "payouts", "flags", "security"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Canonical defaults, mirroring PLAN §12. These are seeds, not application
 * constants: runtime reads must go through `getSettings()`.
 */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({
  economy: {
    coins_per_star: 20_000,
    signup_coins: 20_000,
    daily_gift: [5_000, 7_000, 10_000],
    tap_reward: 10,
    energy_cap: 50,
    regen_seconds: 72,
    ad_reward: 30,
    free_ads_per_day: 10,
    extra_ad_slot_price: 15,
    max_ads_per_day: 30,
    ad_cooldown_seconds: 30,
    ad_revenue_micro: 1_000,
    worker_output_per_hour: [50, 150, 400],
    worker_rent_per_hour: [30, 100, 280],
    worker_max_offline_hours: 8,
    referral_rate: 0.1,
    referral_daily_cap: 20_000,
    referral_max_active: 200,
    max_daily_coins: 50_000,
    tap_power_step: 2,
    tap_power_max_level: 5,
    energy_cap_step: 25,
    energy_cap_max_level: 4,
    regen_step_pct: 0.1,
    regen_max_level: 3,
    // ADR-0004: growth values are tuned so every upgrade stays inside the
    // 2–6 h payback rule from PLAN §2.5 at the reference momentum.
    store_costs: {
      tap_power: { base: 800, growth: 1.18 },
      energy_cap: { base: 1_500, growth: 1.25 },
      regen: { base: 500, growth: 1.3 },
    },
    consumables: {
      double_tap: { price: 15_000, duration_seconds: 1_800 },
      full_energy: { price: 25_000 },
      auto_tap: { price: 60_000, duration_seconds: 900 },
    },
    daily_quests: [
      { id: "taps_300", title: "Tap 300 times", metric: "taps", target: 300, reward: 1_500 },
      { id: "ads_3", title: "Watch 3 ads", metric: "ads", target: 3, reward: 2_000 },
      { id: "earn_5000", title: "Earn 5,000 coins", metric: "coins", target: 5_000, reward: 2_500 },
      { id: "purchase_1", title: "Buy an upgrade", metric: "purchases", target: 1, reward: 2_000 },
      { id: "rent_worker", title: "Rent a worker", metric: "workers", target: 1, reward: 1_500 },
    ],
    weekly_quest_reward: 30_000,
    coin_packs: [
      { id: "pack_100k", coins: 100_000, stars: 10 },
      { id: "pack_500k", coins: 500_000, stars: 30 },
      { id: "pack_1m", coins: 1_000_000, stars: 60 },
    ],
    pack_margin: 1.2,
    base_rate_cap_multiplier: 3,
    payback_reference_momentum: 3,
    payback_min_hours: 2,
    payback_max_hours: 6,
  },
  momentum: {
    base: 1.0,
    streak_per_day: 0.2,
    streak_cap: 1.0,
    duration_tiers: [0.4, 0.8, 1.2, 1.7],
    duration_thresholds_min: [30, 90, 180, 240],
    daily_quests: 0.4,
    weekly_quests: 0.4,
    ads_bonus: 0.4,
    ads_threshold: 10,
    referral_bonus: 0.2,
    referral_cap: 1.2,
    absence_penalty: 0.3,
    min: 0.8,
    max: 6.3,
  },
  payouts: {
    gifts: { starter: 300_000, standard: 500_000, premium: 1_000_000 },
    gift_prices_stars: { starter: 15, standard: 25, premium: 50 },
    gift_ids: { starter: "", standard: "", premium: "" },
    min_account_age_days: 3,
    min_taps: 1_000,
    min_ad_views: 50,
    min_revenue_micro: 1_000,
    revenue_multiplier: 2.0,
    weekly_cap_stars: 20,
    monthly_cap_stars: 50,
    global_budget_ratio: 0.4,
    star_value_micro: 20_000,
    referral_payout_delay_hours: 24,
    referral_qualification: {
      min_age_days: 3,
      min_taps: 5_000,
      min_ad_views: 50,
      min_revenue_micro: 1_000,
    },
  },
  flags: { ads: true, payouts: true, store: true },
  security: {
    max_taps_per_request: 50,
    min_tap_interval_ms: 120,
    tap_cv_threshold: 0.05,
    heartbeat_window_seconds: 300,
    max_daily_minutes: 240,
    auth_max_age_seconds: 3_600,
    initdata_cache_seconds: 60,
    initdata_cache_size: 2_000,
    reconcile_drift_threshold: 0,
    webhook_max_age_seconds: 300,
    admin_callback_max_age_seconds: 900,
  },
});

const CACHE_TTL_MS = 60_000;
let cache: { value: Settings; expiresAt: number } | null = null;

export interface SettingsStore {
  load(): Promise<Partial<Record<SettingsSection, unknown>>>;
}

export async function loadSettingsFromDb(db: Database = getDb()): Promise<Partial<Record<SettingsSection, unknown>>> {
  const rows = await db.select().from(settingsTable);
  const result: Partial<Record<SettingsSection, unknown>> = {};
  for (const row of rows) {
    if ((SETTINGS_SECTIONS as readonly string[]).includes(row.key)) {
      result[row.key as SettingsSection] = row.value;
    }
  }
  return result;
}

export function mergeSettings(partial: Partial<Record<SettingsSection, unknown>>): Settings {
  const merged: Record<string, unknown> = {};
  for (const section of SETTINGS_SECTIONS) {
    const defaults = DEFAULT_SETTINGS[section] as Record<string, unknown>;
    const stored = partial[section];
    merged[section] =
      stored && typeof stored === "object" && !Array.isArray(stored)
        ? { ...defaults, ...(stored as Record<string, unknown>) }
        : { ...defaults };
  }
  const parsed = settingsSchema.safeParse(merged);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new AppError("CONFIG_ERROR", `Invalid settings in database: ${detail}`);
  }
  return parsed.data;
}

/**
 * Reads settings with a 60 s cache (PLAN §4.4). If the database is
 * unreachable, defaults are used and a warning is logged; this keeps the
 * simulator, unit tests and a cold local dev environment working.
 */
export async function getSettings(): Promise<Settings> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  let value = DEFAULT_SETTINGS;
  try {
    const partial = await loadSettingsFromDb();
    value = mergeSettings(partial);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "settings_load_failed_using_defaults",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export function clearSettingsCache(): void {
  cache = null;
}

export async function saveSettingsSection(
  section: SettingsSection,
  value: unknown,
  adminTelegramId: number,
  db: Database = getDb(),
): Promise<Settings> {
  const candidate = { ...DEFAULT_SETTINGS, [section]: value };
  const parsed = settingsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", `Invalid ${section} settings`, {
      details: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
    });
  }
  const sectionValue = parsed.data[section];

  await db.transaction(async (tx) => {
    await tx
      .insert(settingsTable)
      .values({ key: section, value: sectionValue as never })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: sectionValue as never, updatedAt: new Date() },
      });
    await tx.insert(adminAudit).values({
      adminId: adminTelegramId,
      action: `settings.update.${section}`,
      payload: { value: sectionValue },
    });
  });

  clearSettingsCache();
  return getSettings();
}
