import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { dailyActivity } from "@/db/schema";
import type { Activity } from "@/lib/types";

export interface ActivityDelta {
  taps?: number;
  adsWatched?: number;
  secondsActive?: number;
  questsDone?: number;
  coinsEarned?: number;
  purchases?: number;
  workersRented?: number;
  checkedIn?: boolean;
  momentumSnapshot?: number;
}

/**
 * Upserts today's counter row. All counters are additive so concurrent tap
 * batches cannot lose each other's increments.
 */
export async function recordActivity(
  exec: DbExecutor,
  userId: number,
  dateKey: string,
  delta: ActivityDelta,
): Promise<void> {
  const insertValues: typeof dailyActivity.$inferInsert = {
    userId,
    dateKey,
    taps: delta.taps ?? 0,
    adsWatched: delta.adsWatched ?? 0,
    secondsActive: delta.secondsActive ?? 0,
    questsDone: delta.questsDone ?? 0,
    coinsEarned: delta.coinsEarned ?? 0,
    purchases: delta.purchases ?? 0,
    workersRented: delta.workersRented ?? 0,
    checkedIn: delta.checkedIn ?? false,
    ...(delta.momentumSnapshot !== undefined
      ? { momentumSnapshot: delta.momentumSnapshot.toFixed(2) }
      : {}),
  };

  await exec
    .insert(dailyActivity)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [dailyActivity.userId, dailyActivity.dateKey],
      set: {
        taps: sql`${dailyActivity.taps} + ${delta.taps ?? 0}`,
        adsWatched: sql`${dailyActivity.adsWatched} + ${delta.adsWatched ?? 0}`,
        secondsActive: sql`${dailyActivity.secondsActive} + ${delta.secondsActive ?? 0}`,
        questsDone: sql`${dailyActivity.questsDone} + ${delta.questsDone ?? 0}`,
        coinsEarned: sql`${dailyActivity.coinsEarned} + ${delta.coinsEarned ?? 0}`,
        purchases: sql`${dailyActivity.purchases} + ${delta.purchases ?? 0}`,
        workersRented: sql`${dailyActivity.workersRented} + ${delta.workersRented ?? 0}`,
        ...(delta.checkedIn ? { checkedIn: true } : {}),
        ...(delta.momentumSnapshot !== undefined
          ? { momentumSnapshot: delta.momentumSnapshot.toFixed(2) }
          : {}),
      },
    });
}

export async function getActivityForDate(
  exec: DbExecutor,
  userId: number,
  dateKey: string,
): Promise<Activity | null> {
  const [row] = await exec
    .select()
    .from(dailyActivity)
    .where(and(eq(dailyActivity.userId, userId), eq(dailyActivity.dateKey, dateKey)))
    .limit(1);
  if (!row) return null;
  return {
    date: row.dateKey,
    taps: row.taps,
    adsWatched: row.adsWatched,
    secondsActive: row.secondsActive,
    questsDone: row.questsDone,
    coinsEarned: Number(row.coinsEarned),
    purchases: row.purchases,
    workersRented: row.workersRented,
  };
}

export async function getRecentActivity(
  exec: DbExecutor,
  userId: number,
  fromDateKey: string,
  toDateKey: string,
): Promise<Activity[]> {
  const rows = await exec
    .select()
    .from(dailyActivity)
    .where(
      and(
        eq(dailyActivity.userId, userId),
        gte(dailyActivity.dateKey, fromDateKey),
        sql`${dailyActivity.dateKey} <= ${toDateKey}`,
      ),
    )
    .orderBy(desc(dailyActivity.dateKey));

  return rows.map((row) => ({
    date: row.dateKey,
    taps: row.taps,
    adsWatched: row.adsWatched,
    secondsActive: row.secondsActive,
    questsDone: row.questsDone,
    coinsEarned: Number(row.coinsEarned),
    purchases: row.purchases,
    workersRented: row.workersRented,
  }));
}

export async function countCheckedInDays(exec: DbExecutor, userId: number, fromDateKey: string): Promise<number> {
  const [row] = await exec
    .select({ value: sql<string>`count(*)` })
    .from(dailyActivity)
    .where(
      and(
        eq(dailyActivity.userId, userId),
        gte(dailyActivity.dateKey, fromDateKey),
        eq(dailyActivity.checkedIn, true),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function countActiveDays(exec: DbExecutor, userId: number): Promise<number> {
  const [row] = await exec
    .select({ value: sql<string>`count(*)` })
    .from(dailyActivity)
    .where(eq(dailyActivity.userId, userId));
  return Number(row?.value ?? 0);
}
