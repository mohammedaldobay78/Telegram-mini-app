import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { dailyActivity, transactions, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { isoWeekKey, utcDateKey, yesterdayKey } from "@/lib/dates";
import type { Settings } from "@/server/config/settings";
import { recordActivity } from "@/server/economy/activity";
import { hasEntry, post } from "@/server/economy/ledger";
import type { UserRow } from "@/server/services/users";

export interface DailyGiftResult {
  amount: number;
  streakDays: number;
  weeklyReward: number;
  balance: number;
  duplicate: boolean;
}

/** PLAN §2.2 daily gift + weekly chain (§3.3). */
export async function claimDailyGift(
  db: Database,
  user: UserRow,
  settings: Settings,
  now: Date,
): Promise<DailyGiftResult> {
  const today = utcDateKey(now);
  const week = isoWeekKey(now);

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: users.id, lastCheckinDate: users.lastCheckinDate, streakDays: users.streakDays })
      .from(users)
      .where(eq(users.id, user.id))
      .for("update")
      .limit(1);

    if (!locked) throw new AppError("NOT_FOUND", "User not found");
    if (locked.lastCheckinDate === today) {
      throw new AppError("CONFLICT", "Daily gift already claimed today", { details: { date: today } });
    }

    const streakDays = locked.lastCheckinDate === yesterdayKey(today) ? locked.streakDays + 1 : 1;
    const amount =
      streakDays >= 7
        ? settings.economy.daily_gift[2]
        : streakDays >= 3
          ? settings.economy.daily_gift[1]
          : settings.economy.daily_gift[0];

    if (await hasEntry(tx, user.id, `daily:${today}`)) {
      throw new AppError("CONFLICT", "Daily gift already claimed today");
    }

    const result = await post(tx, {
      userId: user.id,
      delta: amount,
      type: "daily",
      refId: today,
      idempotencyKey: `daily:${today}`,
      meta: { streakDays },
    });

    await tx
      .update(users)
      .set({ lastCheckinDate: today, streakDays, updatedAt: now })
      .where(eq(users.id, user.id));

    await recordActivity(tx, user.id, today, { checkedIn: true, coinsEarned: amount });

    const [checkinsRow] = await tx
      .select({ value: sql<string>`count(*)` })
      .from(dailyActivity)
      .where(
        sql`${dailyActivity.userId} = ${user.id} and ${dailyActivity.checkedIn} = true and ${dailyActivity.dateKey} >= ${`${today}`}::date - interval '6 days'`,
      );

    let weeklyReward = 0;
    if (Number(checkinsRow?.value ?? 0) >= 7) {
      const key = `weekly:${week}`;
      if (!(await hasEntry(tx, user.id, key))) {
        await post(tx, {
          userId: user.id,
          delta: settings.economy.weekly_quest_reward,
          type: "quest",
          refId: key,
          idempotencyKey: key,
          meta: { weekly: true, week },
        });
        weeklyReward = settings.economy.weekly_quest_reward;
      }
    }

    return {
      amount,
      streakDays,
      weeklyReward,
      balance: result.balance + weeklyReward,
      duplicate: false,
    };
  });
}

export interface QuestClaimResult {
  reward: number;
  balance: number;
  duplicate: boolean;
  questsDone: number;
}

export async function claimQuest(
  db: Database,
  user: UserRow,
  settings: Settings,
  questId: string,
  now: Date,
): Promise<QuestClaimResult> {
  const quest = settings.economy.daily_quests.find((entry) => entry.id === questId);
  if (!quest) throw new AppError("NOT_FOUND", "Unknown quest");

  const today = utcDateKey(now);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(dailyActivity)
      .where(sql`${dailyActivity.userId} = ${user.id} and ${dailyActivity.dateKey} = ${today}::date`)
      .limit(1);

    const progress =
      quest.metric === "taps"
        ? (row?.taps ?? 0)
        : quest.metric === "ads"
          ? (row?.adsWatched ?? 0)
          : quest.metric === "coins"
            ? Number(row?.coinsEarned ?? 0)
            : quest.metric === "purchases"
              ? (row?.purchases ?? 0)
              : (row?.workersRented ?? 0);

    const key = `quest:${today}:${quest.id}`;
    if (await hasEntry(tx, user.id, key)) {
      const [current] = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, user.id)).limit(1);
      return {
        reward: 0,
        balance: Number(current?.balance ?? 0),
        duplicate: true,
        questsDone: row?.questsDone ?? 0,
      };
    }

    if (progress < quest.target) {
      throw new AppError("CONFLICT", "Quest is not complete yet", {
        details: { progress, target: quest.target },
      });
    }

    const result = await post(tx, {
      userId: user.id,
      delta: quest.reward,
      type: "quest",
      refId: `${today}:${quest.id}`,
      idempotencyKey: key,
      meta: { questId: quest.id, metric: quest.metric },
    });

    await recordActivity(tx, user.id, today, { questsDone: 1, coinsEarned: quest.reward });

    return {
      reward: quest.reward,
      balance: result.balance,
      duplicate: false,
      questsDone: (row?.questsDone ?? 0) + 1,
    };
  });
}

export async function recentTransactions(
  db: Database,
  userId: number,
  limit = 30,
): Promise<{ id: number; delta: number; type: string; createdAt: string; meta: unknown }[]> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(sql`${transactions.createdAt} desc`)
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    delta: Number(row.delta),
    type: row.type,
    createdAt: row.createdAt.toISOString(),
    meta: row.meta,
  }));
}
