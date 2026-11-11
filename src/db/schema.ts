import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * PLAN §5 data model. Forward-only migrations only. Money is BIGINT and is
 * never represented as a float in the money path.
 *
 * Extensions approved in ADR-0002:
 *  - users.active_buffs (consumable expiry state)
 *  - telegram_updates (webhook idempotency by update_id)
 */

export const users = pgTable(
  "users",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
    username: text("username"),
    firstName: text("first_name"),
    photoUrl: text("photo_url"),
    languageCode: text("language_code"),
    isAdmin: boolean("is_admin").notNull().default(false),
    isBanned: boolean("is_banned").notNull().default(false),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    energy: integer("energy").notNull().default(50),
    energyUpdatedAt: timestamp("energy_updated_at", { withTimezone: true }).notNull().defaultNow(),
    momentum: numeric("momentum", { precision: 4, scale: 2 }).notNull().default("1.00"),
    momentumUpdatedAt: timestamp("momentum_updated_at", { withTimezone: true }).notNull().defaultNow(),
    streakDays: integer("streak_days").notNull().default(0),
    lastCheckinDate: date("last_checkin_date"),
    referralCode: text("referral_code").notNull().unique(),
    referredBy: bigint("referred_by", { mode: "number" }),
    referralUnlock: boolean("referral_unlock").notNull().default(false),
    lifetimeCoinsEarned: bigint("lifetime_coins_earned", { mode: "number" }).notNull().default(0),
    lifetimeAdViews: integer("lifetime_ad_views").notNull().default(0),
    estRevenueMicro: bigint("est_revenue_micro", { mode: "number" }).notNull().default(0),
    riskFlags: jsonb("risk_flags").notNull().default({}),
    activeBuffs: jsonb("active_buffs").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("users_balance_non_negative", sql`${table.balance} >= 0`),
    check("users_energy_non_negative", sql`${table.energy} >= 0`),
    index("users_referred_by_idx").on(table.referredBy),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    delta: bigint("delta", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    refId: text("ref_id"),
    idempotencyKey: text("idempotency_key").unique(),
    momentum: numeric("momentum", { precision: 4, scale: 2 }),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("transactions_user_created_idx").on(table.userId, table.createdAt),
    index("transactions_type_created_idx").on(table.type, table.createdAt),
    index("transactions_ref_idx").on(table.refId),
  ],
);

export const dailyActivity = pgTable(
  "daily_activity",
  {
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    dateKey: date("date_key").notNull(),
    taps: integer("taps").notNull().default(0),
    adsWatched: integer("ads_watched").notNull().default(0),
    secondsActive: integer("seconds_active").notNull().default(0),
    questsDone: integer("quests_done").notNull().default(0),
    coinsEarned: bigint("coins_earned", { mode: "number" }).notNull().default(0),
    momentumSnapshot: numeric("momentum_snapshot", { precision: 4, scale: 2 }),
    purchases: integer("purchases").notNull().default(0),
    workersRented: integer("workers_rented").notNull().default(0),
    checkedIn: boolean("checked_in").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.dateKey] }),
    index("daily_activity_date_idx").on(table.dateKey),
  ],
);

export const upgrades = pgTable(
  "upgrades",
  {
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    level: integer("level").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.kind] })],
);

export const workers = pgTable(
  "workers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    tier: integer("tier").notNull(),
    rentalStartedAt: timestamp("rental_started_at", { withTimezone: true }).notNull(),
    rentalEndsAt: timestamp("rental_ends_at", { withTimezone: true }).notNull(),
    lastCollectedAt: timestamp("last_collected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workers_user_idx").on(table.userId)],
);

export const adTickets = pgTable(
  "ad_tickets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    nonce: text("nonce").notNull().unique(),
    pricePaid: bigint("price_paid", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ad_tickets_user_idx").on(table.userId)],
);

export const adViews = pgTable(
  "ad_views",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    nonce: text("nonce").notNull().unique(),
    rewarded: boolean("rewarded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ad_views_user_created_idx").on(table.userId, table.createdAt)],
);

export const payments = pgTable("payments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => users.id),
  telegramPaymentChargeId: text("telegram_payment_charge_id").notNull().unique(),
  stars: integer("stars").notNull(),
  coins: bigint("coins", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const redemptions = pgTable(
  "redemptions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    coins: bigint("coins", { mode: "number" }).notNull(),
    giftId: text("gift_id").notNull(),
    stars: integer("stars").notNull(),
    status: text("status").notNull(),
    adminMessageId: bigint("admin_message_id", { mode: "number" }),
    error: text("error"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("redemptions_status_idx").on(table.status),
    index("redemptions_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const referrals = pgTable(
  "referrals",
  {
    referrerId: bigint("referrer_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    inviteeId: bigint("invitee_id", { mode: "number" })
      .notNull()
      .unique()
      .references(() => users.id),
    qualified: boolean("qualified").notNull().default(false),
    signupIpHash: text("signup_ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.referrerId, table.inviteeId] }),
    index("referrals_referrer_idx").on(table.referrerId),
    index("referrals_ip_idx").on(table.signupIpHash, table.createdAt),
  ],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAudit = pgTable(
  "admin_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    adminId: bigint("admin_id", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("admin_audit_created_idx").on(table.createdAt)],
);

export const anomalies = pgTable(
  "anomalies",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" }),
    kind: text("kind").notNull(),
    score: numeric("score"),
    payload: jsonb("payload"),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("anomalies_resolved_idx").on(table.resolved, table.createdAt),
    index("anomalies_user_idx").on(table.userId),
  ],
);

/** Webhook idempotency by Telegram update_id (PLAN §6). */
export const telegramUpdates = pgTable("telegram_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Unique nonces for tap batches and heartbeats (PLAN §10.3). */
export const usedNonces = pgTable(
  "used_nonces",
  {
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    nonce: text("nonce").notNull(),
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.scope, table.nonce] }),
    uniqueIndex("used_nonces_nonce_uq").on(table.nonce),
  ],
);

/** Push budget: at most 2 bot messages per user per day (PLAN §3.2). */
export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    dayKey: date("day_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta").notNull().default({}),
  },
  (table) => [
    index("notifications_user_sent_idx").on(table.userId, table.sentAt),
    uniqueIndex("notifications_user_kind_day_uq").on(table.userId, table.kind, table.dayKey),
  ],
);
