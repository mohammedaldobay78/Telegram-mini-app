import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adTickets, adViews, users } from "@/db/schema";
import { claimAd, creditAdsgramReward, startAd } from "@/server/services/ads";
import { createUser, makeTestDb, testSettings, type TestDb } from "../helpers/db";

const settings = testSettings();

async function userRow(ctx: TestDb, userId: number) {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!row) throw new Error("missing user");
  return row;
}

describe("ad fraud controls", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await makeTestDb();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("rewards a completed mock ad exactly once", async () => {
    const user = await createUser(ctx.db);
    const now = new Date();

    const started = await startAd(ctx.db, user, settings, now);
    expect(started).toMatchObject({ free: true, ticket: false, provider: "mock" });
    expect(started.nonce).toContain(`mock_${user.id}`);

    const claim = await claimAd(ctx.db, user, settings, started.nonce, 2, new Date(now.getTime() + 1_000));
    expect(claim).toMatchObject({ reward: 60, balance: 60, duplicate: false });

    const replay = await claimAd(ctx.db, user, settings, started.nonce, 2, new Date(now.getTime() + 2_000));
    expect(replay).toMatchObject({ reward: 0, duplicate: true });

    const fresh = await userRow(ctx, user.id);
    expect(fresh.lifetimeAdViews).toBe(1);
    expect(Number(fresh.estRevenueMicro)).toBe(settings.economy.ad_revenue_micro);
    expect(Number(fresh.balance)).toBe(60);

    const views = await ctx.db.select().from(adViews).where(eq(adViews.userId, user.id));
    expect(views.filter((view) => view.rewarded)).toHaveLength(1);
  });

  it("enforces the cooldown between rewarded ads", async () => {
    const user = await createUser(ctx.db);
    const now = new Date();

    const started = await startAd(ctx.db, user, settings, now);
    await claimAd(ctx.db, user, settings, started.nonce, 1, new Date(now.getTime() + 1_000));

    await expect(
      startAd(ctx.db, user, settings, new Date(now.getTime() + 2_000)),
    ).rejects.toMatchObject({ code: "COOLDOWN" });

    // After the cooldown the next ad is allowed.
    const later = new Date(now.getTime() + settings.economy.ad_cooldown_seconds * 1000 + 5_000);
    const next = await startAd(ctx.db, user, settings, later);
    expect(next.nonce).not.toBe(started.nonce);
  });

  it("rejects unknown and expired ad sessions", async () => {
    const user = await createUser(ctx.db);
    const now = new Date();

    await expect(claimAd(ctx.db, user, settings, "never_issued_nonce", 1, now)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await ctx.db.insert(adViews).values({
      userId: user.id,
      provider: "mock",
      nonce: "expired_ad_nonce",
      rewarded: false,
      createdAt: new Date(now.getTime() - 16 * 60 * 1000),
    });
    await expect(claimAd(ctx.db, user, settings, "expired_ad_nonce", 1, now)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("caps ad starts at the daily limit", async () => {
    const user = await createUser(ctx.db);
    const now = new Date();

    await ctx.db.insert(adViews).values(
      Array.from({ length: settings.economy.max_ads_per_day }, (_, index) => ({
        userId: user.id,
        provider: "mock",
        nonce: `cap_start_${index}`,
        rewarded: false,
        createdAt: now,
      })),
    );

    await expect(startAd(ctx.db, user, settings, now)).rejects.toMatchObject({ code: "DAILY_CAP_REACHED" });
  });

  it("requires a paid ticket after the free quota", async () => {
    const user = await createUser(ctx.db);
    const now = new Date();

    await ctx.db.insert(adViews).values(
      Array.from({ length: settings.economy.free_ads_per_day }, (_, index) => ({
        userId: user.id,
        provider: "mock",
        nonce: `free_${index}`,
        rewarded: false,
        createdAt: now,
      })),
    );

    await expect(startAd(ctx.db, user, settings, now)).rejects.toMatchObject({ code: "CONFLICT" });

    await ctx.db.insert(adTickets).values({
      userId: user.id,
      nonce: "ticket:test:1",
      pricePaid: settings.economy.extra_ad_slot_price,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    });

    const started = await startAd(ctx.db, user, settings, now);
    expect(started).toMatchObject({ free: false, ticket: true });

    const tickets = await ctx.db.select().from(adTickets).where(eq(adTickets.userId, user.id));
    expect(tickets[0]?.usedAt).not.toBeNull();

    // The same ticket cannot be spent twice.
    await expect(startAd(ctx.db, user, settings, now)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("caps rewarded claims at the daily limit", async () => {
    const user = await createUser(ctx.db);
    const now = new Date();

    await ctx.db.insert(adViews).values([
      ...Array.from({ length: settings.economy.max_ads_per_day }, (_, index) => ({
        userId: user.id,
        provider: "mock",
        nonce: `rewarded_${index}`,
        rewarded: true,
        createdAt: now,
      })),
      { userId: user.id, provider: "mock", nonce: "claim_over_cap", rewarded: false, createdAt: now },
    ]);

    await expect(claimAd(ctx.db, user, settings, "claim_over_cap", 1, now)).rejects.toMatchObject({
      code: "DAILY_CAP_REACHED",
    });
  });

  it("makes Adsgram clients wait for the signed server postback", async () => {
    const user = await createUser(ctx.db);
    const now = new Date();

    await ctx.db.insert(adViews).values({
      userId: user.id,
      provider: "adsgram",
      nonce: "adsgram_nonce_1",
      rewarded: false,
      createdAt: now,
    });

    const claim = await claimAd(ctx.db, user, settings, "adsgram_nonce_1", 2, now);
    expect(claim).toMatchObject({ reward: 0, pendingPostback: true, duplicate: false });
    expect(Number((await userRow(ctx, user.id)).balance)).toBe(0);

    const credited = await creditAdsgramReward(ctx.db, user, settings, "adsgram_nonce_1", 2, now);
    expect(credited).toMatchObject({ reward: 60, balance: 60, duplicate: false });

    const replay = await creditAdsgramReward(ctx.db, user, settings, "adsgram_nonce_1", 2, now);
    expect(replay).toMatchObject({ reward: 0, duplicate: true });
    expect(Number((await userRow(ctx, user.id)).balance)).toBe(60);
  });

  it("honours the ads kill switch for starts, claims and postbacks", async () => {
    const user = await createUser(ctx.db);
    const now = new Date();
    const off = testSettings({ flags: { ads: false } });

    await expect(startAd(ctx.db, user, off, now)).rejects.toMatchObject({ code: "KILL_SWITCHED" });
    await expect(claimAd(ctx.db, user, off, "any_nonce_1", 1, now)).rejects.toMatchObject({
      code: "KILL_SWITCHED",
    });
    await expect(creditAdsgramReward(ctx.db, user, off, "any_nonce_2", 1, now)).rejects.toMatchObject({
      code: "KILL_SWITCHED",
    });
  });
});
