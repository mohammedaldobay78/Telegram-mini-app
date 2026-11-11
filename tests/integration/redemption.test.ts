import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminAudit, adViews, redemptions, transactions, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { recordActivity } from "@/server/economy/activity";
import { adminDecideRedemption, requestRedemption } from "@/server/services/redemption";
import { requireUser } from "@/server/services/users";
import { createUser, makeTestDb, testSettings, type TestDb } from "../helpers/db";

const NOW = new Date("2026-02-15T12:00:00.000Z");
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

function settings() {
  // One rewarded ad view is worth $1 in this fixture, so the global payout
  // budget allows a 15-Star gift without inserting hundreds of rows.
  return testSettings({ economy: { ad_revenue_micro: 1_000_000 } });
}

async function seedEligibleUser(ctx: TestDb, overrides: Partial<typeof users.$inferInsert> = {}) {
  const created = await createUser(ctx.db, { balance: 300_000, createdAt: CREATED_AT });
  await ctx.db
    .update(users)
    .set({ lifetimeAdViews: 50, estRevenueMicro: 600_000, ...overrides })
    .where(eq(users.id, created.id));
  await recordActivity(ctx.db, created.id, "2026-02-14", { taps: 1_500 });
  await ctx.db.insert(adViews).values({
    userId: created.id,
    provider: "mock",
    nonce: `budget:${created.id}`,
    rewarded: true,
    createdAt: NOW,
  });
  return requireUser(ctx.db, created.id);
}

async function ledgerRows(ctx: TestDb, userId: number) {
  return ctx.db.select().from(transactions).where(eq(transactions.userId, userId));
}

async function balanceOf(ctx: TestDb, userId: number): Promise<number> {
  const [row] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, userId));
  return Number(row?.balance ?? 0);
}

describe("redemption state machine", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await makeTestDb();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("locks coins and creates a requested redemption", async () => {
    const user = await seedEligibleUser(ctx);
    const result = await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:1", NOW);

    expect(result).toMatchObject({
      coins: 300_000,
      stars: 15,
      status: "requested",
      duplicate: false,
      giftId: "gift-starter",
    });
    expect(await balanceOf(ctx, user.id)).toBe(0);

    const rows = await ledgerRows(ctx, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "redemption_lock" });
    expect(Number(rows[0]?.delta)).toBe(-300_000);
  });

  it("is idempotent for the same key and never locks coins twice", async () => {
    const user = await seedEligibleUser(ctx);
    const first = await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:idem", NOW);
    const second = await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:idem", NOW);

    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await balanceOf(ctx, user.id)).toBe(0);
    expect(await ledgerRows(ctx, user.id)).toHaveLength(1);
    expect(await ctx.db.select().from(redemptions)).toHaveLength(1);
  });

  it("refuses a second open redemption", async () => {
    const user = await seedEligibleUser(ctx);
    await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:open", NOW);

    const error = await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:open2", NOW).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("FORBIDDEN");
    const issues = ((error as AppError).details as { issues?: { code: string }[] }).issues ?? [];
    expect(issues.map((issue) => issue.code)).toContain("OPEN_REDEMPTION");
    expect(await ctx.db.select().from(redemptions)).toHaveLength(1);
  });

  it("enforces the ad-revenue gate", async () => {
    const user = await seedEligibleUser(ctx, { estRevenueMicro: 0 });
    const error = await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:revenue", NOW).catch(
      (cause: unknown) => cause,
    );

    expect((error as AppError).code).toBe("FORBIDDEN");
    const issues = ((error as AppError).details as { issues?: { code: string }[] }).issues ?? [];
    expect(issues.map((issue) => issue.code)).toContain("REVENUE_GATE");
  });

  it("enforces the minimum account age and tap/ad thresholds", async () => {
    const young = await seedEligibleUser(ctx, { createdAt: new Date("2026-02-14T00:00:00.000Z") });
    const youngError = await requestRedemption(ctx.db, young, settings(), "starter", "redeem:test:young", NOW).catch(
      (cause: unknown) => cause,
    );
    const youngIssues = ((youngError as AppError).details as { issues?: { code: string }[] }).issues ?? [];
    expect(youngIssues.map((issue) => issue.code)).toContain("ACCOUNT_TOO_NEW");

    const noAds = await seedEligibleUser(ctx, { lifetimeAdViews: 0 });
    const adsError = await requestRedemption(ctx.db, noAds, settings(), "starter", "redeem:test:ads", NOW).catch(
      (cause: unknown) => cause,
    );
    const adsIssues = ((adsError as AppError).details as { issues?: { code: string }[] }).issues ?? [];
    expect(adsIssues.map((issue) => issue.code)).toContain("ADS_TOO_LOW");
  });

  it("blocks accounts carrying risk flags", async () => {
    const user = await seedEligibleUser(ctx, { riskFlags: { IP_CLUSTER_5_PER_24H: { at: NOW.toISOString() } } });
    const error = await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:risk", NOW).catch(
      (cause: unknown) => cause,
    );

    const issues = ((error as AppError).details as { issues?: { code: string }[] }).issues ?? [];
    expect(issues.map((issue) => issue.code)).toContain("RISK_FLAGS");
  });

  it("honours the payouts kill switch", async () => {
    const user = await seedEligibleUser(ctx);
    await expect(
      requestRedemption(ctx.db, user, testSettings({ flags: { payouts: false } }), "starter", "redeem:test:flag", NOW),
    ).rejects.toMatchObject({ code: "KILL_SWITCHED" });
    expect(await balanceOf(ctx, user.id)).toBe(300_000);
  });

  it("pauses new requests when the global budget is exhausted", async () => {
    const user = await seedEligibleUser(ctx);
    // One rewarded view at $0.001 funds 0.02 Stars, far below the 15-Star gift.
    const tight = testSettings({ economy: { ad_revenue_micro: 1_000 } });
    await expect(
      requestRedemption(ctx.db, user, tight, "starter", "redeem:test:budget", NOW),
    ).rejects.toMatchObject({ code: "KILL_SWITCHED" });
    expect(await balanceOf(ctx, user.id)).toBe(300_000);
  });

  it("refunds the coins and audits an admin reject", async () => {
    const user = await seedEligibleUser(ctx);
    const request = await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:reject", NOW);

    const decided = await adminDecideRedemption(ctx.db, request.id, "reject", 42, settings(), NOW);
    expect(decided.status).toBe("rejected");

    expect(await balanceOf(ctx, user.id)).toBe(300_000);
    const rows = await ledgerRows(ctx, user.id);
    const refund = rows.find((row) => row.type === "redemption_refund");
    expect(refund).toBeDefined();
    expect(Number(refund?.delta)).toBe(300_000);

    const [audit] = await ctx.db.select().from(adminAudit);
    expect(audit).toMatchObject({ adminId: 42, action: "redemption.reject" });

    await expect(adminDecideRedemption(ctx.db, request.id, "reject", 42, settings(), NOW)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await balanceOf(ctx, user.id)).toBe(300_000);
  });

  it("approves without releasing the locked coins", async () => {
    const user = await seedEligibleUser(ctx);
    const request = await requestRedemption(ctx.db, user, settings(), "starter", "redeem:test:approve", NOW);

    const decided = await adminDecideRedemption(ctx.db, request.id, "approve", 42, settings(), NOW);
    expect(decided.status).toBe("approved");
    expect(await balanceOf(ctx, user.id)).toBe(0);

    await expect(adminDecideRedemption(ctx.db, request.id, "approve", 42, settings(), NOW)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("blocks an approval that would exceed the weekly Star cap", async () => {
    const user = await seedEligibleUser(ctx);
    await ctx.db.insert(redemptions).values({
      userId: user.id,
      coins: 500_000,
      giftId: "gift-standard",
      stars: 10,
      status: "approved",
      createdAt: NOW,
    });
    const [pending] = await ctx.db
      .insert(redemptions)
      .values({
        userId: user.id,
        coins: 300_000,
        giftId: "gift-starter",
        stars: 15,
        status: "requested",
        idempotencyKey: "direct:cap",
        createdAt: NOW,
      })
      .returning();
    if (!pending) throw new Error("failed to insert pending redemption");

    await expect(adminDecideRedemption(ctx.db, pending.id, "approve", 42, settings(), NOW)).rejects.toMatchObject({
      code: "DAILY_CAP_REACHED",
    });

    const [row] = await ctx.db
      .select()
      .from(redemptions)
      .where(and(eq(redemptions.id, pending.id), eq(redemptions.status, "requested")));
    expect(row).toBeDefined();
  });

  it("does not create a redemption when the gift catalog cannot resolve an id", async () => {
    const user = await seedEligibleUser(ctx);
    const noIds = testSettings({
      economy: { ad_revenue_micro: 1_000_000 },
      payouts: { gift_ids: { starter: "", standard: "", premium: "" } },
    });
    const error = await requestRedemption(ctx.db, user, noIds, "starter", "redeem:test:no-gift", NOW).catch(
      (cause: unknown) => cause,
    );

    // No BOT_TOKEN in tests, so the catalog call fails upstream instead of
    // silently locking coins.
    expect(error).toBeInstanceOf(AppError);
    expect(["CONFIG_ERROR", "UPSTREAM_ERROR"]).toContain((error as AppError).code);
    expect(await balanceOf(ctx, user.id)).toBe(300_000);
    expect(await ctx.db.select().from(redemptions)).toHaveLength(0);
  });
});
