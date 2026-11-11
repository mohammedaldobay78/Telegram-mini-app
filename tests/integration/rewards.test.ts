import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dailyActivity, transactions, users } from "@/db/schema";
import { recordActivity } from "@/server/economy/activity";
import { claimDailyGift, claimQuest, recentTransactions } from "@/server/services/rewards";
import { createUser, makeTestDb, testSettings, type TestDb } from "../helpers/db";

const settings = testSettings();

function at(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

function plusDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function balanceOf(ctx: TestDb, userId: number): Promise<number> {
  const [row] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, userId));
  return Number(row?.balance ?? 0);
}

describe("daily gift and quests", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await makeTestDb();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("pays the first daily gift and blocks a second claim the same day", async () => {
    const user = await createUser(ctx.db);
    const result = await claimDailyGift(ctx.db, user, settings, at("2026-01-05"));

    expect(result).toMatchObject({ amount: 5_000, streakDays: 1, weeklyReward: 0, duplicate: false });
    expect(await balanceOf(ctx, user.id)).toBe(5_000);

    await expect(claimDailyGift(ctx.db, user, settings, at("2026-01-05"))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await balanceOf(ctx, user.id)).toBe(5_000);
  });

  it("grows the streak and the gift across consecutive days", async () => {
    const user = await createUser(ctx.db);

    const day1 = await claimDailyGift(ctx.db, user, settings, at("2026-01-05"));
    const day2 = await claimDailyGift(ctx.db, user, settings, at("2026-01-06"));
    const day3 = await claimDailyGift(ctx.db, user, settings, at("2026-01-07"));

    expect([day1.streakDays, day2.streakDays, day3.streakDays]).toEqual([1, 2, 3]);
    expect([day1.amount, day2.amount, day3.amount]).toEqual([5_000, 5_000, 7_000]);
    expect(await balanceOf(ctx, user.id)).toBe(17_000);

    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.streakDays).toBe(3);
    expect(row?.lastCheckinDate).toBe("2026-01-07");
  });

  it("resets the streak after a missed day", async () => {
    const user = await createUser(ctx.db);
    await claimDailyGift(ctx.db, user, settings, at("2026-01-05"));

    const afterGap = await claimDailyGift(ctx.db, user, settings, at("2026-01-07"));
    expect(afterGap.streakDays).toBe(1);
    expect(afterGap.amount).toBe(5_000);
  });

  it("pays the weekly chain bonus once on the seventh consecutive check-in", async () => {
    const user = await createUser(ctx.db);
    const start = "2026-01-05";
    let total = 0;

    for (let day = 0; day < 6; day += 1) {
      const result = await claimDailyGift(ctx.db, user, settings, at(plusDays(start, day)));
      expect(result.weeklyReward).toBe(0);
      total += result.amount;
    }

    const seventh = await claimDailyGift(ctx.db, user, settings, at(plusDays(start, 6)));
    expect(seventh.streakDays).toBe(7);
    expect(seventh.amount).toBe(10_000);
    expect(seventh.weeklyReward).toBe(settings.economy.weekly_quest_reward);

    total += seventh.amount;
    expect(await balanceOf(ctx, user.id)).toBe(total + seventh.weeklyReward);
    expect(await balanceOf(ctx, user.id)).toBe(78_000);

    const weekly = await ctx.db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, user.id));
    const weeklyRows = weekly.filter((row) => row.type === "quest" && row.idempotencyKey?.startsWith("weekly:"));
    expect(weeklyRows).toHaveLength(1);
  });

  it("marks today's activity as checked in", async () => {
    const user = await createUser(ctx.db);
    await claimDailyGift(ctx.db, user, settings, at("2026-01-05"));

    const [row] = await ctx.db
      .select()
      .from(dailyActivity)
      .where(eq(dailyActivity.userId, user.id));
    expect(row).toMatchObject({ dateKey: "2026-01-05", checkedIn: true });
    expect(Number(row?.coinsEarned)).toBe(5_000);
  });

  it("pays a completed daily quest once", async () => {
    const user = await createUser(ctx.db);
    await recordActivity(ctx.db, user.id, "2026-01-05", { taps: 300, coinsEarned: 3_000 });

    const result = await claimQuest(ctx.db, user, settings, "taps_300", at("2026-01-05"));
    expect(result).toMatchObject({ reward: 1_500, duplicate: false, questsDone: 1 });
    expect(await balanceOf(ctx, user.id)).toBe(1_500);

    const replay = await claimQuest(ctx.db, user, settings, "taps_300", at("2026-01-05"));
    expect(replay).toMatchObject({ reward: 0, duplicate: true, balance: 1_500 });
    expect(await balanceOf(ctx, user.id)).toBe(1_500);

    const [row] = await ctx.db.select().from(dailyActivity).where(eq(dailyActivity.userId, user.id));
    expect(row?.questsDone).toBe(1);
  });

  it("refuses a quest before its target is met", async () => {
    const user = await createUser(ctx.db);
    await recordActivity(ctx.db, user.id, "2026-01-05", { taps: 299 });

    await expect(claimQuest(ctx.db, user, settings, "taps_300", at("2026-01-05"))).rejects.toMatchObject({
      code: "CONFLICT",
      details: { progress: 299, target: 300 },
    });
    expect(await balanceOf(ctx, user.id)).toBe(0);
  });

  it("reads progress from the correct metric per quest", async () => {
    const user = await createUser(ctx.db);
    await recordActivity(ctx.db, user.id, "2026-01-05", { adsWatched: 3, purchases: 1, workersRented: 1 });

    for (const questId of ["ads_3", "purchase_1", "rent_worker"]) {
      const result = await claimQuest(ctx.db, user, settings, questId, at("2026-01-05"));
      expect(result.reward).toBeGreaterThan(0);
      expect(result.duplicate).toBe(false);
    }
  });

  it("rejects an unknown quest id", async () => {
    const user = await createUser(ctx.db);
    await expect(claimQuest(ctx.db, user, settings, "does_not_exist", at("2026-01-05"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns recent transactions newest first", async () => {
    const user = await createUser(ctx.db);
    await claimDailyGift(ctx.db, user, settings, at("2026-01-05"));

    const rows = await recentTransactions(ctx.db, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 5_000, type: "daily" });
  });
});
