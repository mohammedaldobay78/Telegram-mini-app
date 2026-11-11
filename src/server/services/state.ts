import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { adTickets, adViews, redemptions, referrals, transactions, workers } from "@/db/schema";
import type { StateResponse, WorkerTier } from "@/lib/types";
import { addDaysKey, utcDateKey } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { Settings } from "@/server/config/settings";
import { countActiveDays, countCheckedInDays, getActivityForDate, getRecentActivity } from "@/server/economy/activity";
import { computeEnergy } from "@/server/economy/energy";
import { computeMomentum } from "@/server/economy/momentum";
import { tapReward } from "@/server/economy/store";
import { giftCatalog } from "@/server/economy/pricing";
import { accrueAll } from "@/server/economy/workers";
import { getUpgradeLevels, requireUser, toPublicUser } from "@/server/services/users";
import type { UserRow } from "@/server/services/users";

export interface BuildStateInput {
  db: Database;
  user: UserRow;
  settings: Settings;
  now: Date;
}

export async function buildState({ db, user, settings, now }: BuildStateInput): Promise<StateResponse> {
  const today = utcDateKey(now);
  const weekStart = addDaysKey(today, -6);
  const dayStart = new Date(`${today}T00:00:00.000Z`);

  const [
    levels,
    todayActivity,
    recentActivity,
    workerRows,
    questTx,
    ticketRow,
    adsTodayRow,
    lastAdRow,
    referralTotalRow,
    referralQualifiedRow,
    referralEarnedRow,
    referralTodayRow,
    redemptionRows,
    deliveredRow,
    weeklyCheckins,
    activeDays,
  ] = await Promise.all([
    getUpgradeLevels(db, user.id),
    getActivityForDate(db, user.id, today),
    getRecentActivity(db, user.id, weekStart, today),
    db.select().from(workers).where(eq(workers.userId, user.id)),
    db
      .select({ refId: transactions.refId })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          eq(transactions.type, "quest"),
          sql`${transactions.refId} like ${`${today}:%`}`,
        ),
      ),
    db
      .select({ value: sql<string>`count(*)` })
      .from(adTickets)
      .where(
        and(eq(adTickets.userId, user.id), sql`${adTickets.usedAt} is null`, gte(adTickets.expiresAt, now)),
      ),
    db
      .select({ value: sql<string>`count(*)` })
      .from(adViews)
      .where(
        and(
          eq(adViews.userId, user.id),
          eq(adViews.rewarded, true),
          gte(adViews.createdAt, dayStart),
        ),
      ),
    db
      .select({ createdAt: adViews.createdAt })
      .from(adViews)
      .where(and(eq(adViews.userId, user.id), eq(adViews.rewarded, true)))
      .orderBy(desc(adViews.createdAt))
      .limit(1),
    db
      .select({ value: sql<string>`count(*)` })
      .from(referrals)
      .where(eq(referrals.referrerId, user.id)),
    db
      .select({ value: sql<string>`count(*)` })
      .from(referrals)
      .where(and(eq(referrals.referrerId, user.id), eq(referrals.qualified, true))),
    db
      .select({ value: sql<string>`coalesce(sum(${transactions.delta}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.userId, user.id), eq(transactions.type, "referral"))),
    db
      .select({ value: sql<string>`coalesce(sum(${transactions.delta}), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          eq(transactions.type, "referral"),
          gte(transactions.createdAt, dayStart),
        ),
      ),
    db
      .select()
      .from(redemptions)
      .where(eq(redemptions.userId, user.id))
      .orderBy(desc(redemptions.createdAt))
      .limit(20),
    db
      .select({ value: sql<string>`count(*)` })
      .from(redemptions)
      .where(and(eq(redemptions.userId, user.id), eq(redemptions.status, "delivered"))),
    countCheckedInDays(db, user.id, weekStart),
    countActiveDays(db, user.id),
  ]);

  const adsWatchedToday = Number(adsTodayRow[0]?.value ?? 0);
  const qualifiedReferrals = Number(referralQualifiedRow[0]?.value ?? 0);
  const dailyQuestSetComplete = (todayActivity?.questsDone ?? 0) >= settings.economy.daily_quests.length;
  const weeklyQuestComplete = weeklyCheckins >= 7;

  const momentum = computeMomentum({
    settings: settings.momentum,
    activity: recentActivity,
    today,
    streakDays: user.streakDays,
    dailyQuestSetComplete,
    weeklyQuestComplete,
    activeReferrals: qualifiedReferrals,
  });

  const energy = computeEnergy(
    settings.economy,
    { energyCapLevel: levels.energy_cap, regenLevel: levels.regen },
    user.energy,
    user.energyUpdatedAt,
    now,
  );

  const claimedQuests = new Set(
    questTx.map((row) => row.refId).filter((refId): refId is string => typeof refId === "string"),
  );

  const quests = settings.economy.daily_quests.map((quest) => {
    const progress =
      quest.metric === "taps"
        ? (todayActivity?.taps ?? 0)
        : quest.metric === "ads"
          ? adsWatchedToday
          : quest.metric === "coins"
            ? (todayActivity?.coinsEarned ?? 0)
            : quest.metric === "purchases"
              ? (todayActivity?.purchases ?? 0)
              : (todayActivity?.workersRented ?? 0);

    return {
      id: quest.id,
      title: quest.title,
      metric: quest.metric,
      target: quest.target,
      progress: Math.min(progress, quest.target),
      reward: quest.reward,
      claimed: claimedQuests.has(`${today}:${quest.id}`),
    };
  });

  const workerRowsTyped = workerRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    tier: row.tier,
    rentalStartedAt: row.rentalStartedAt,
    rentalEndsAt: row.rentalEndsAt,
    lastCollectedAt: row.lastCollectedAt,
  }));

  const accrued = accrueAll(settings.economy, workerRowsTyped, momentum.total, now);
  const accrualById = new Map(accrued.rows.map((row) => [row.workerId, row]));

  const cooldownRemaining = lastAdRow[0]
    ? Math.max(0, Math.ceil((lastAdRow[0].createdAt.getTime() + settings.economy.ad_cooldown_seconds * 1000 - now.getTime()) / 1000))
    : 0;

  const gifts = giftCatalog(settings.payouts, {
    deliveredCount: Number(deliveredRow[0]?.value ?? 0),
    activeDays,
  });

  const botUsername = getEnv().BOT_USERNAME ?? "your_bot";

  return {
    user: toPublicUser(user),
    momentum,
    energy: {
      energy: energy.energy,
      cap: energy.cap,
      regenSeconds: energy.regenSeconds,
      nextRegenInSeconds: energy.nextRegenInSeconds,
      updatedAt: energy.energyUpdatedAt.toISOString(),
    },
    quests,
    dailyGiftAvailable: user.lastCheckinDate !== today,
    streakDays: user.streakDays,
    weeklyCheckins,
    ads: {
      watchedToday: adsWatchedToday,
      freeRemaining: Math.max(0, settings.economy.free_ads_per_day - adsWatchedToday),
      tickets: Number(ticketRow[0]?.value ?? 0),
      cooldownSeconds: cooldownRemaining,
      dailyCapReached: adsWatchedToday >= settings.economy.max_ads_per_day,
    },
    workers: workerRowsTyped.map((row) => {
      const accrual = accrualById.get(row.id);
      return {
        id: row.id,
        tier: row.tier as WorkerTier,
        startedAt: row.rentalStartedAt.toISOString(),
        endsAt: row.rentalEndsAt.toISOString(),
        accruedCoins: accrual?.coins ?? 0,
        active: row.rentalEndsAt.getTime() > now.getTime(),
      };
    }),
    workerCoinsPending: accrued.total,
    tapReward: tapReward(settings.economy, levels.tap_power),
    referrals: {
      code: user.referralCode,
      inviteLink: `https://t.me/${botUsername}?startapp=ref_${user.referralCode}`,
      total: Number(referralTotalRow[0]?.value ?? 0),
      qualified: qualifiedReferrals,
      earnedCoins: Number(referralEarnedRow[0]?.value ?? 0),
      dailyCap: Math.max(
        0,
        settings.economy.referral_daily_cap - Number(referralTodayRow[0]?.value ?? 0),
      ),
    },
    gifts,
    redemptions: redemptionRows.map((row) => ({
      id: row.id,
      giftId: row.giftId,
      coins: Number(row.coins),
      stars: row.stars,
      status: row.status as StateResponse["redemptions"][number]["status"],
      createdAt: row.createdAt.toISOString(),
      error: row.error,
    })),
    exchangeRate: settings.economy.coins_per_star,
    serverTime: now.toISOString(),
  };
}
