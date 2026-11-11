import { z } from "zod";
import { LEDGER_TYPES } from "./types";

const bigIntLike = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) =>
  typeof value === "string" ? Number(value) : value,
);

export const activitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  taps: z.number().int().nonnegative().default(0),
  adsWatched: z.number().int().nonnegative().default(0),
  secondsActive: z.number().int().nonnegative().default(0),
  questsDone: z.number().int().nonnegative().default(0),
  coinsEarned: z.number().int().nonnegative().default(0),
  purchases: z.number().int().nonnegative().default(0),
  workersRented: z.number().int().nonnegative().default(0),
});

export const energySchema = z.object({
  energy: z.number().int().nonnegative(),
  cap: z.number().int().positive(),
  regenSeconds: z.number().int().positive(),
  nextRegenInSeconds: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

export const momentumComponentsSchema = z.object({
  base: z.number(),
  streak: z.number(),
  duration: z.number(),
  dailyQuests: z.number(),
  weeklyQuests: z.number(),
  ads: z.number(),
  referrals: z.number(),
  penalty: z.number(),
  total: z.number(),
});

export const giftSchema = z.object({
  id: z.string(),
  title: z.string(),
  stars: z.number().int().positive(),
  coins: z.number().int().positive(),
  unlocked: z.boolean(),
  note: z.string(),
});

export const questSchema = z.object({
  id: z.string(),
  title: z.string(),
  metric: z.enum(["taps", "ads", "coins", "purchases", "workers"]),
  target: z.number().int().positive(),
  progress: z.number().int().nonnegative(),
  reward: z.number().int().positive(),
  claimed: z.boolean(),
});

export const userPublicSchema = z.object({
  id: bigIntLike,
  telegramId: bigIntLike,
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  isAdmin: z.boolean(),
  balance: bigIntLike,
  lifetimeCoinsEarned: bigIntLike,
  createdAt: z.string(),
});

export const workerViewSchema = z.object({
  id: bigIntLike,
  tier: z.number().int().min(1).max(3),
  startedAt: z.string(),
  endsAt: z.string(),
  accruedCoins: bigIntLike,
  active: z.boolean(),
});

export const redemptionViewSchema = z.object({
  id: bigIntLike,
  giftId: z.string(),
  coins: bigIntLike,
  stars: z.number().int(),
  status: z.enum(["requested", "approved", "sent", "delivered", "failed", "refunded", "rejected"]),
  createdAt: z.string(),
  error: z.string().nullable(),
});

export const stateResponseSchema = z.object({
  user: userPublicSchema,
  momentum: momentumComponentsSchema,
  energy: energySchema,
  quests: z.array(questSchema),
  dailyGiftAvailable: z.boolean(),
  streakDays: z.number().int().nonnegative(),
  weeklyCheckins: z.number().int().nonnegative(),
  ads: z.object({
    watchedToday: z.number().int().nonnegative(),
    freeRemaining: z.number().int().nonnegative(),
    tickets: z.number().int().nonnegative(),
    cooldownSeconds: z.number().int().nonnegative(),
    dailyCapReached: z.boolean(),
  }),
  workers: z.array(workerViewSchema),
  workerCoinsPending: bigIntLike,
  tapReward: z.number().int().positive(),
  referrals: z.object({
    code: z.string(),
    inviteLink: z.string(),
    total: z.number().int().nonnegative(),
    qualified: z.number().int().nonnegative(),
    earnedCoins: bigIntLike,
    dailyCap: bigIntLike,
  }),
  gifts: z.array(giftSchema),
  redemptions: z.array(redemptionViewSchema),
  exchangeRate: z.number().int().positive(),
  serverTime: z.string(),
});

export const authResponseSchema = z.object({
  user: userPublicSchema,
  isNewUser: z.boolean(),
  referralApplied: z.boolean(),
  state: stateResponseSchema,
});

export const ledgerEntrySchema = z.object({
  userId: bigIntLike,
  delta: bigIntLike.refine((value) => value !== 0, "delta must not be zero"),
  type: z.enum(LEDGER_TYPES),
  refId: z.string().optional(),
  idempotencyKey: z.string().min(8).max(160).optional(),
  momentum: z.number().min(0).max(10).optional(),
  meta: z.record(z.unknown()).default({}),
});

export const tapRequestSchema = z.object({
  taps: z.number().int().min(1).max(500),
  clientTs: z.number().int().nonnegative().optional(),
  nonce: z.string().min(8).max(120),
  interTapMs: z.array(z.number().nonnegative()).max(500).optional(),
});

export const storeKindSchema = z.enum([
  "tap_power",
  "energy_cap",
  "regen",
  "double_tap",
  "full_energy",
  "auto_tap",
  "ad_ticket",
]);

export const purchaseRequestSchema = z.object({
  kind: storeKindSchema,
  idempotencyKey: z.string().min(8).max(160),
});

export const workerRentRequestSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  hours: z.union([z.literal(1), z.literal(8), z.literal(24)]),
  idempotencyKey: z.string().min(8).max(160),
});

export const idempotentRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(160),
});

export const adStartRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(160).optional(),
});

export const adClaimRequestSchema = z.object({
  nonce: z.string().min(8).max(160),
  idempotencyKey: z.string().min(8).max(160),
});

export const questClaimRequestSchema = z.object({
  questId: z.string().min(1).max(80),
  idempotencyKey: z.string().min(8).max(160),
});

export const redeemRequestSchema = z.object({
  giftId: z.string().min(1).max(80),
  idempotencyKey: z.string().min(8).max(160),
});

export const adminRedemptionRequestSchema = z.union([
  z.object({ callbackData: z.string().min(8).max(200) }),
  z.object({
    redemptionId: bigIntLike,
    action: z.enum(["approve", "reject"]),
    at: z.number().int().positive(),
    signature: z.string().min(8).max(200),
  }),
]);

export const shopCoinsRequestSchema = z.object({
  packId: z.string().min(1).max(80),
});

export const referralsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const adsgramRewardQuerySchema = z.object({
  userid: z.string().min(1),
  secret: z.string().optional(),
  nonce: z.string().optional(),
  reward: z.string().optional(),
});

export const heartbeatRequestSchema = z.object({
  nonce: z.string().min(8).max(160),
  clientTs: z.number().int().nonnegative(),
  visible: z.boolean().default(true),
});

export type TapRequest = z.infer<typeof tapRequestSchema>;
export type PurchaseRequest = z.infer<typeof purchaseRequestSchema>;
export type WorkerRentRequest = z.infer<typeof workerRentRequestSchema>;
export type AdClaimRequest = z.infer<typeof adClaimRequestSchema>;
export type QuestClaimRequest = z.infer<typeof questClaimRequestSchema>;
export type RedeemRequest = z.infer<typeof redeemRequestSchema>;
export type AdminRedemptionRequest = z.infer<typeof adminRedemptionRequestSchema>;
