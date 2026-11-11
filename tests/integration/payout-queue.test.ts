import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adViews, redemptions, transactions, users } from "@/db/schema";
import { recordActivity } from "@/server/economy/activity";
import { adminDecideRedemption, processPayoutQueue, requestRedemption } from "@/server/services/redemption";
import { requireUser } from "@/server/services/users";
import { createUser, makeTestDb, testSettings, type TestDb } from "../helpers/db";

const telegram = vi.hoisted(() => ({
  sendGift: vi.fn(),
  getMyStarBalance: vi.fn(),
}));

vi.mock("@/server/telegram/api", () => ({
  sendGift: telegram.sendGift,
  getMyStarBalance: telegram.getMyStarBalance,
  sendMessage: vi.fn(async () => true),
  createInvoiceLink: vi.fn(async () => "https://t.me/invoice/test"),
  getAvailableGifts: vi.fn(async () => []),
  setWebhook: vi.fn(async () => true),
  setMyCommands: vi.fn(async () => true),
  getWebhookInfo: vi.fn(async () => ({ url: "" })),
  callTelegram: vi.fn(),
}));

const NOW = new Date("2026-02-15T12:00:00.000Z");
const settings = testSettings({ economy: { ad_revenue_micro: 1_000_000 } });

async function seedApproved(ctx: TestDb, idempotencyKey: string) {
  const created = await createUser(ctx.db, {
    balance: 300_000,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  await ctx.db
    .update(users)
    .set({ lifetimeAdViews: 50, estRevenueMicro: 600_000 })
    .where(eq(users.id, created.id));
  await recordActivity(ctx.db, created.id, "2026-02-14", { taps: 1_500 });
  await ctx.db.insert(adViews).values({
    userId: created.id,
    provider: "mock",
    nonce: `budget:${created.id}`,
    rewarded: true,
    createdAt: NOW,
  });

  const user = await requireUser(ctx.db, created.id);
  const request = await requestRedemption(ctx.db, user, settings, "starter", idempotencyKey, NOW);
  await adminDecideRedemption(ctx.db, request.id, "approve", 42, settings, NOW);
  return { user: await requireUser(ctx.db, created.id), redemptionId: request.id };
}

async function balanceOf(ctx: TestDb, userId: number): Promise<number> {
  const [row] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, userId));
  return Number(row?.balance ?? 0);
}

describe("payout queue", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await makeTestDb();
    telegram.sendGift.mockReset();
    telegram.getMyStarBalance.mockReset();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("delivers approved redemptions and marks them delivered", async () => {
    const { user, redemptionId } = await seedApproved(ctx, "redeem:queue:ok");
    telegram.getMyStarBalance.mockResolvedValue(500);
    telegram.sendGift.mockResolvedValue(true);

    const run = await processPayoutQueue(ctx.db, settings, NOW);

    expect(run).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    expect(telegram.sendGift).toHaveBeenCalledTimes(1);
    expect(telegram.sendGift).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.telegramId, giftId: "gift-starter" }),
    );

    const [row] = await ctx.db.select().from(redemptions).where(eq(redemptions.id, redemptionId));
    expect(row?.status).toBe("delivered");

    // A second run has nothing to do.
    const again = await processPayoutQueue(ctx.db, settings, NOW);
    expect(again.sent).toBe(0);
    expect(telegram.sendGift).toHaveBeenCalledTimes(1);
  });

  it("refunds and records the failure when Telegram rejects the gift", async () => {
    const { user, redemptionId } = await seedApproved(ctx, "redeem:queue:fail");
    telegram.getMyStarBalance.mockResolvedValue(500);
    telegram.sendGift.mockRejectedValue(new Error("GIFT_UNAVAILABLE"));

    const run = await processPayoutQueue(ctx.db, settings, NOW);

    expect(run).toMatchObject({ sent: 0, failed: 1 });
    const [row] = await ctx.db.select().from(redemptions).where(eq(redemptions.id, redemptionId));
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("GIFT_UNAVAILABLE");
    expect(await balanceOf(ctx, user.id)).toBe(300_000);

    const refund = (
      await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id))
    ).find((entry) => entry.type === "redemption_refund");
    expect(refund).toBeDefined();
    expect(Number(refund?.delta)).toBe(300_000);
  });

  it("pauses the queue when the bot Stars balance cannot be read", async () => {
    await seedApproved(ctx, "redeem:queue:nostars");
    telegram.getMyStarBalance.mockRejectedValue(new Error("no token"));

    const run = await processPayoutQueue(ctx.db, settings, NOW);

    expect(run).toMatchObject({ sent: 0, failed: 0, skipped: 1, starsBalance: null });
    expect(telegram.sendGift).not.toHaveBeenCalled();
  });

  it("skips a redemption it cannot afford from the current Stars balance", async () => {
    const { redemptionId } = await seedApproved(ctx, "redeem:queue:poor");
    telegram.getMyStarBalance.mockResolvedValue(5);

    const run = await processPayoutQueue(ctx.db, settings, NOW);

    expect(run).toMatchObject({ sent: 0, failed: 0, skipped: 1, starsBalance: 5 });
    expect(telegram.sendGift).not.toHaveBeenCalled();

    const [row] = await ctx.db.select().from(redemptions).where(eq(redemptions.id, redemptionId));
    expect(row?.status).toBe("approved");
  });

  it("never re-sends or refunds a redemption already marked sent", async () => {
    const user = await createUser(ctx.db, { balance: 0 });
    const [stuck] = await ctx.db
      .insert(redemptions)
      .values({
        userId: user.id,
        coins: 300_000,
        giftId: "gift-starter",
        stars: 15,
        // Simulates a crash after Telegram accepted the gift but before the
        // delivered update: the row must stay untouched for manual review.
        status: "sent",
        idempotencyKey: "redeem:queue:stuck",
        createdAt: new Date(NOW.getTime() - 3_600_000),
        updatedAt: new Date(NOW.getTime() - 3_600_000),
      })
      .returning();
    if (!stuck) throw new Error("failed to insert sent redemption");
    telegram.getMyStarBalance.mockResolvedValue(500);

    const run = await processPayoutQueue(ctx.db, settings, NOW);

    expect(run).toMatchObject({ sent: 0, failed: 0, skipped: 0 });
    expect(telegram.sendGift).not.toHaveBeenCalled();
    expect(await balanceOf(ctx, user.id)).toBe(0);

    const [row] = await ctx.db.select().from(redemptions).where(eq(redemptions.id, stuck.id));
    expect(row?.status).toBe("sent");
    expect(await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id))).toHaveLength(0);
  });

  it("does nothing when the payouts kill switch is off", async () => {
    const { redemptionId } = await seedApproved(ctx, "redeem:queue:flag");
    const run = await processPayoutQueue(ctx.db, testSettings({ flags: { payouts: false } }), NOW);

    expect(run).toEqual({ sent: 0, failed: 0, skipped: 0, starsBalance: null });
    expect(telegram.getMyStarBalance).not.toHaveBeenCalled();

    const [row] = await ctx.db.select().from(redemptions).where(eq(redemptions.id, redemptionId));
    expect(row?.status).toBe("approved");
  });
});
