import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { adTickets, adViews, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { addDaysKey, utcDateKey } from "@/lib/dates";
import type { Settings } from "@/server/config/settings";
import { getAdProvider, type AdStartPayload } from "@/server/ads";
import { getEnv } from "@/lib/env";
import { recordActivity } from "@/server/economy/activity";
import { hasEntry, post } from "@/server/economy/ledger";
import type { UserRow } from "@/server/services/users";

const AD_NONCE_TTL_MS = 15 * 60 * 1000;

export interface AdStartResult extends AdStartPayload {
  free: boolean;
  ticket: boolean;
  adsRemaining: number;
  cooldownSeconds: number;
}

/** PLAN §2.7 + §8 + §10.3: free quota, tickets, cooldown, daily cap. */
export async function startAd(
  db: Database,
  user: UserRow,
  settings: Settings,
  now: Date,
): Promise<AdStartResult> {
  if (!settings.flags.ads) {
    throw new AppError("KILL_SWITCHED", "Ads are temporarily disabled", { retryable: true, details: { flag: "ads" } });
  }

  const dayStart = new Date(`${utcDateKey(now)}T00:00:00.000Z`);
  const provider = getAdProvider();

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");

    const [countRow] = await tx
      .select({ value: sql<string>`count(*)` })
      .from(adViews)
      .where(and(eq(adViews.userId, user.id), gte(adViews.createdAt, dayStart)));
    const started = Number(countRow?.value ?? 0);

    if (started >= settings.economy.max_ads_per_day) {
      throw new AppError("DAILY_CAP_REACHED", "Daily ad limit reached", {
        details: { started, cap: settings.economy.max_ads_per_day },
      });
    }

    const [last] = await tx
      .select({ createdAt: adViews.createdAt })
      .from(adViews)
      .where(and(eq(adViews.userId, user.id), eq(adViews.rewarded, true)))
      .orderBy(desc(adViews.createdAt))
      .limit(1);

    if (last) {
      const remaining = last.createdAt.getTime() + settings.economy.ad_cooldown_seconds * 1000 - now.getTime();
      if (remaining > 0) {
        throw new AppError("COOLDOWN", "Ad cooldown is still active", {
          retryable: true,
          details: { retryAfterSeconds: Math.ceil(remaining / 1000) },
        });
      }
    }

    const free = started < settings.economy.free_ads_per_day;
    let ticket = false;

    if (!free) {
      const [availableTicket] = await tx
        .select()
        .from(adTickets)
        .where(
          and(eq(adTickets.userId, user.id), sql`${adTickets.usedAt} is null`, gte(adTickets.expiresAt, now)),
        )
        .orderBy(adTickets.expiresAt)
        .for("update")
        .limit(1);

      if (!availableTicket) {
        throw new AppError("CONFLICT", "No ad ticket available. Buy one in the store.", {
          details: { price: settings.economy.extra_ad_slot_price },
        });
      }
      await tx.update(adTickets).set({ usedAt: now }).where(eq(adTickets.id, availableTicket.id));
      ticket = true;
    }

    const nonce = await provider.createNonce(String(user.id));
    await tx.insert(adViews).values({
      userId: user.id,
      provider: provider.id,
      nonce,
      rewarded: false,
    });

    return {
      nonce,
      provider: provider.id,
      blockId: provider.id === "adsgram" ? getEnv().ADSGRAM_BLOCK_ID : undefined,
      free,
      ticket,
      adsRemaining: Math.max(0, settings.economy.max_ads_per_day - started),
      cooldownSeconds: settings.economy.ad_cooldown_seconds,
    };
  });
}

export interface AdClaimResult {
  reward: number;
  balance: number;
  duplicate: boolean;
  pendingPostback?: boolean;
}

export async function claimAd(
  db: Database,
  user: UserRow,
  settings: Settings,
  nonce: string,
  momentum: number,
  now: Date,
): Promise<AdClaimResult> {
  if (!settings.flags.ads) {
    throw new AppError("KILL_SWITCHED", "Ads are temporarily disabled", { retryable: true });
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");

    const [view] = await tx
      .select()
      .from(adViews)
      .where(and(eq(adViews.nonce, nonce), eq(adViews.userId, user.id)))
      .for("update")
      .limit(1);

    if (!view) throw new AppError("NOT_FOUND", "Ad session not found");
    if (view.rewarded) {
      return { reward: 0, balance: Number(locked.balance), duplicate: true };
    }
    if (now.getTime() - view.createdAt.getTime() > AD_NONCE_TTL_MS) {
      throw new AppError("CONFLICT", "Ad session expired; start a new ad");
    }

    if (view.provider === "adsgram") {
      return { reward: 0, balance: Number(locked.balance), duplicate: false, pendingPostback: true };
    }

    const dayStart = new Date(`${utcDateKey(now)}T00:00:00.000Z`);
    const [countRow] = await tx
      .select({ value: sql<string>`count(*)` })
      .from(adViews)
      .where(and(eq(adViews.userId, user.id), eq(adViews.rewarded, true), gte(adViews.createdAt, dayStart)));
    const watched = Number(countRow?.value ?? 0);
    if (watched >= settings.economy.max_ads_per_day) {
      throw new AppError("DAILY_CAP_REACHED", "Daily ad limit reached");
    }

    const reward = Math.floor(settings.economy.ad_reward * Math.max(0, momentum));
    if (reward <= 0) throw new AppError("CONFLICT", "Ad reward is zero");

    const result = await post(tx, {
      userId: user.id,
      delta: reward,
      type: "ad",
      refId: nonce,
      idempotencyKey: `ad:${nonce}`,
      momentum,
      meta: { provider: view.provider, revenue_micro: settings.economy.ad_revenue_micro },
    });

    await tx.update(adViews).set({ rewarded: true }).where(eq(adViews.id, view.id));
    await tx
      .update(users)
      .set({
        lifetimeAdViews: sql`${users.lifetimeAdViews} + 1`,
        estRevenueMicro: sql`${users.estRevenueMicro} + ${settings.economy.ad_revenue_micro}`,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await recordActivity(tx, user.id, utcDateKey(now), {
      adsWatched: 1,
      coinsEarned: reward,
      momentumSnapshot: momentum,
    });

    return { reward, balance: result.balance, duplicate: false };
  });
}

/**
 * Adsgram postback. The secret is verified by the provider; the nonce and
 * daily caps still apply. Safe to retry: the ledger key is derived from the
 * user + nonce.
 */
export async function creditAdsgramReward(
  db: Database,
  user: UserRow,
  settings: Settings,
  nonce: string,
  momentum: number,
  now: Date,
): Promise<AdClaimResult> {
  if (!settings.flags.ads) throw new AppError("KILL_SWITCHED", "Ads are temporarily disabled");

  const key = `adsgram:${user.id}:${nonce}`;
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");
    if (await hasEntry(tx, user.id, key)) {
      return { reward: 0, balance: Number(locked.balance), duplicate: true };
    }

    const dayStart = new Date(`${utcDateKey(now)}T00:00:00.000Z`);
    const [countRow] = await tx
      .select({ value: sql<string>`count(*)` })
      .from(adViews)
      .where(and(eq(adViews.userId, user.id), eq(adViews.rewarded, true), gte(adViews.createdAt, dayStart)));
    if (Number(countRow?.value ?? 0) >= settings.economy.max_ads_per_day) {
      throw new AppError("DAILY_CAP_REACHED", "Daily ad limit reached");
    }

    const reward = Math.floor(settings.economy.ad_reward * Math.max(0, momentum));
    const result = await post(tx, {
      userId: user.id,
      delta: reward,
      type: "ad",
      refId: nonce,
      idempotencyKey: key,
      momentum,
      meta: { provider: "adsgram", revenue_micro: settings.economy.ad_revenue_micro },
    });

    await tx
      .insert(adViews)
      .values({ userId: user.id, provider: "adsgram", nonce, rewarded: true })
      .onConflictDoUpdate({ target: adViews.nonce, set: { rewarded: true } });

    await tx
      .update(users)
      .set({
        lifetimeAdViews: sql`${users.lifetimeAdViews} + 1`,
        estRevenueMicro: sql`${users.estRevenueMicro} + ${settings.economy.ad_revenue_micro}`,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await recordActivity(tx, user.id, utcDateKey(now), {
      adsWatched: 1,
      coinsEarned: reward,
      momentumSnapshot: momentum,
    });

    return { reward, balance: result.balance, duplicate: false };
  });
}
