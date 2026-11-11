import type { z } from "zod";
import type {
  activitySchema,
  authResponseSchema,
  energySchema,
  giftSchema,
  ledgerEntrySchema,
  momentumComponentsSchema,
  questSchema,
  stateResponseSchema,
  userPublicSchema,
} from "./schemas";

export type Activity = z.infer<typeof activitySchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type EnergyState = z.infer<typeof energySchema>;
export type Gift = z.infer<typeof giftSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
/** Accepted shape for `ledger.post`; defaults (`meta`) are filled by the schema. */
export type LedgerEntryInput = z.input<typeof ledgerEntrySchema>;
export type MomentumComponents = z.infer<typeof momentumComponentsSchema>;
export type Quest = z.infer<typeof questSchema>;
export type StateResponse = z.infer<typeof stateResponseSchema>;
export type UserPublic = z.infer<typeof userPublicSchema>;

export type UpgradeKind = "tap_power" | "energy_cap" | "regen";
export type ConsumableKind = "double_tap" | "full_energy" | "auto_tap" | "ad_ticket";
export type StoreKind = UpgradeKind | ConsumableKind;
export type WorkerTier = 1 | 2 | 3;
export type WorkerHours = 1 | 8 | 24;

export const LEDGER_TYPES = [
  "tap",
  "ad",
  "daily",
  "signup",
  "quest",
  "referral",
  "worker_collect",
  "store_purchase",
  "worker_rent",
  "redemption_lock",
  "redemption_refund",
  "clawback",
  "stars_purchase",
  "admin_adjust",
] as const;

export type LedgerType = (typeof LEDGER_TYPES)[number];

/** Types that increase `users.lifetime_coins_earned` (PLAN §2.12.6). */
export const LIFETIME_EARNING_TYPES: ReadonlySet<LedgerType> = new Set([
  "tap",
  "ad",
  "daily",
  "signup",
  "quest",
  "referral",
  "worker_collect",
  "stars_purchase",
  "admin_adjust",
]);

export type RedemptionStatus =
  | "requested"
  | "approved"
  | "sent"
  | "delivered"
  | "failed"
  | "refunded"
  | "rejected";

export const REDEMPTION_TRANSITIONS: Record<RedemptionStatus, readonly RedemptionStatus[]> = {
  requested: ["approved", "rejected"],
  approved: ["sent", "failed", "rejected"],
  sent: ["delivered", "failed"],
  delivered: [],
  failed: ["refunded"],
  refunded: [],
  rejected: [],
};

export interface RequestContext {
  requestId: string;
  route: string;
  telegramId?: number;
}
