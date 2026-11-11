import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { anomalies, dailyActivity, transactions, users } from "@/db/schema";
import type { MomentumComponents } from "@/lib/types";
import { recordActivity } from "@/server/economy/activity";
import { performTapBatch } from "@/server/services/tap";
import { createUser, makeTestDb, testSettings, type TestDb } from "../helpers/db";

const settings = testSettings();
const NOW = new Date("2026-03-01T10:00:00.000Z");

function momentum(total = 2, duration = 0.4): MomentumComponents {
  return {
    base: 1,
    streak: 0.2,
    duration,
    dailyQuests: 0,
    weeklyQuests: 0,
    ads: 0,
    referrals: 0,
    penalty: -0.2,
    total,
  };
}

function tapInput(nonce: string, taps = 5, interTapMs?: number[]) {
  return { taps, nonce, interTapMs };
}

describe("tap anti-fraud", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await makeTestDb();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("credits a batch once and pays the signup bonus on the first tap", async () => {
    const user = await createUser(ctx.db);
    const result = await performTapBatch(ctx.db, user, settings, tapInput("tap_nonce_0001"), momentum(), NOW);

    expect(result).toMatchObject({ taps: 5, reward: 100, duplicate: false, signupBonus: 20_000 });
    expect(result.balance).toBe(20_100);
    expect(result.energy).toBe(45);
    expect(result.flagged).toBe(false);

    const rows = await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id));
    expect(rows.map((row) => row.type).sort()).toEqual(["signup", "tap"]);
  });

  it("rejects a replayed tap nonce without paying twice", async () => {
    const user = await createUser(ctx.db);
    const input = tapInput("tap_replay_0001");
    await performTapBatch(ctx.db, user, settings, input, momentum(), NOW);

    const replay = await performTapBatch(ctx.db, user, settings, input, momentum(), NOW);

    expect(replay).toMatchObject({ taps: 0, reward: 0, duplicate: true, signupBonus: 0 });
    expect(replay.balance).toBe(20_100);

    const rows = await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id));
    expect(rows).toHaveLength(2);
  });

  it("caps an oversized batch at the server ceiling and flags it", async () => {
    const user = await createUser(ctx.db);
    const result = await performTapBatch(ctx.db, user, settings, tapInput("tap_oversize_01", 500), momentum(), NOW);

    expect(result.taps).toBe(settings.security.max_taps_per_request);
    expect(result.flagged).toBe(true);
    expect(result.flagReasons).toContain("TAP_BATCH_OVER_CEILING");

    const [anomaly] = await ctx.db.select().from(anomalies).where(eq(anomalies.userId, user.id));
    expect(anomaly).toMatchObject({ kind: "TAP_PATTERN" });
  });

  it("strips the duration bonus from a perfectly regular tap cadence", async () => {
    const user = await createUser(ctx.db);
    const cadence = Array.from({ length: 10 }, () => 500);
    const result = await performTapBatch(
      ctx.db,
      user,
      settings,
      tapInput("tap_macro_00001", 5, cadence),
      momentum(2, 0.4),
      NOW,
    );

    expect(result.flagged).toBe(true);
    expect(result.flagReasons).toContain("TAP_CADENCE_TOO_REGULAR");
    expect(result.momentum.duration).toBe(0);
    expect(result.momentum.total).toBe(1.6);
    expect(result.reward).toBe(80);
  });

  it("also flags impossibly fast intervals", async () => {
    const user = await createUser(ctx.db);
    const result = await performTapBatch(
      ctx.db,
      user,
      settings,
      tapInput("tap_fast_000001", 3, [40, 45, 38, 42, 41, 39, 44, 40]),
      momentum(),
      NOW,
    );

    expect(result.flagReasons).toContain("TAP_INTERVAL_TOO_FAST");
  });

  it("does not flag a human-looking cadence", async () => {
    const user = await createUser(ctx.db);
    const result = await performTapBatch(
      ctx.db,
      user,
      settings,
      tapInput("tap_human_00001", 5, [130, 620, 240, 1500, 180, 990, 300, 2100, 160, 780]),
      momentum(),
      NOW,
    );

    expect(result.flagged).toBe(false);
    expect(result.flagReasons).toHaveLength(0);
  });

  it("caps the batch at the available energy", async () => {
    const user = await createUser(ctx.db, { energy: 3 });
    const result = await performTapBatch(ctx.db, user, settings, tapInput("tap_low_energy", 10), momentum(1, 0), NOW);

    expect(result.taps).toBe(3);
    expect(result.reward).toBe(30);
    expect(result.energy).toBe(0);
  });

  it("rejects a batch with no energy left", async () => {
    const user = await createUser(ctx.db, { energy: 0 });
    await expect(
      performTapBatch(ctx.db, user, settings, tapInput("tap_empty_00001"), momentum(), NOW),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ENERGY" });
  });

  it("rejects taps after the daily coin cap", async () => {
    const user = await createUser(ctx.db);
    await recordActivity(ctx.db, user.id, "2026-03-01", { coinsEarned: settings.economy.max_daily_coins });

    await expect(
      performTapBatch(ctx.db, user, settings, tapInput("tap_daily_cap_1"), momentum(), NOW),
    ).rejects.toMatchObject({ code: "DAILY_CAP_REACHED" });

    expect(await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id))).toHaveLength(0);
  });

  it("refuses taps from a restricted account", async () => {
    const user = await createUser(ctx.db);
    await ctx.db.update(users).set({ isBanned: true }).where(eq(users.id, user.id));
    const banned = (await ctx.db.select().from(users).where(eq(users.id, user.id)))[0];
    if (!banned) throw new Error("missing user");

    await expect(
      performTapBatch(ctx.db, banned, settings, tapInput("tap_banned_0001"), momentum(), NOW),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records taps and earnings in daily activity", async () => {
    const user = await createUser(ctx.db);
    await performTapBatch(ctx.db, user, settings, tapInput("tap_activity_01"), momentum(), NOW);

    const [row] = await ctx.db
      .select()
      .from(dailyActivity)
      .where(eq(dailyActivity.userId, user.id));
    expect(row).toMatchObject({ dateKey: "2026-03-01", taps: 5 });
    expect(Number(row?.coinsEarned)).toBe(100);
  });
});
