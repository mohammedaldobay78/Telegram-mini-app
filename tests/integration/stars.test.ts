import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { payments, transactions, users } from "@/db/schema";
import { coinPacks, creditSuccessfulPayment, requireValidPack } from "@/server/services/stars";
import { createUser, makeTestDb, testSettings, type TestDb } from "../helpers/db";

const NOW = new Date("2026-02-15T12:00:00.000Z");
const PACK = { id: "pack_100k", coins: 100_000, stars: 10 };

function paymentInput(userId: number, telegramUserId: number, overrides: Partial<{
  telegramPaymentChargeId: string;
  invoicePayload: string;
  currency: string;
  totalAmount: number;
}> = {}) {
  return {
    telegramPaymentChargeId: "charge:test:1",
    invoicePayload: `coins:${PACK.id}:${userId}:nonce`,
    currency: "XTR",
    totalAmount: PACK.stars,
    telegramUserId,
    ...overrides,
  };
}

describe("Stars coin packs", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await makeTestDb();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("lists the configured packs and rejects an arbitrageable one", () => {
    const settings = testSettings();
    const packs = coinPacks(settings);
    expect(packs.map((pack) => pack.id)).toEqual(["pack_100k", "pack_500k", "pack_1m"]);
    expect(packs.every((pack) => pack.valid)).toBe(true);

    const bad = testSettings({ economy: { coin_packs: [{ id: "bad", coins: 100_000, stars: 5 }] } });
    expect(() => requireValidPack(bad, "bad")).toThrowError(/temporarily unavailable/);
  });

  it("credits a verified payment exactly once", async () => {
    const user = await createUser(ctx.db);
    const settings = testSettings();

    const first = await creditSuccessfulPayment(
      ctx.db,
      settings,
      paymentInput(user.id, user.telegramId),
      NOW,
    );
    expect(first).toMatchObject({ credited: true, coins: 100_000, balance: 100_000 });

    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(Number(row?.balance)).toBe(100_000);
    expect(Number(row?.lifetimeCoinsEarned)).toBe(100_000);

    const ledger = await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "stars_purchase", refId: "charge:test:1" });
  });

  it("treats a replayed charge id as a no-op", async () => {
    const user = await createUser(ctx.db);
    const settings = testSettings();
    const input = paymentInput(user.id, user.telegramId);

    await creditSuccessfulPayment(ctx.db, settings, input, NOW);
    const replay = await creditSuccessfulPayment(ctx.db, settings, input, NOW);

    expect(replay).toMatchObject({ credited: false, coins: 0, reason: "DUPLICATE" });
    expect(replay.balance).toBe(100_000);
    expect(await ctx.db.select().from(payments)).toHaveLength(1);
    expect(await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id))).toHaveLength(1);
  });

  it("uses the new charge id but never double-credits the same invoice", async () => {
    const user = await createUser(ctx.db);
    const settings = testSettings();
    const input = paymentInput(user.id, user.telegramId, { telegramPaymentChargeId: "charge:test:2" });

    await creditSuccessfulPayment(ctx.db, settings, input, NOW);
    const second = await creditSuccessfulPayment(
      ctx.db,
      settings,
      { ...input, telegramPaymentChargeId: "charge:test:3" },
      NOW,
    );

    // Different charge ids are separate payments: two packs, two credits.
    expect(second).toMatchObject({ credited: true, balance: 200_000, coins: 100_000 });
  });

  it("rejects a payment whose amount or currency does not match the pack", async () => {
    const user = await createUser(ctx.db);
    const settings = testSettings();

    await expect(
      creditSuccessfulPayment(
        ctx.db,
        settings,
        paymentInput(user.id, user.telegramId, { totalAmount: 9, telegramPaymentChargeId: "charge:short" }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      creditSuccessfulPayment(
        ctx.db,
        settings,
        paymentInput(user.id, user.telegramId, { currency: "USD", telegramPaymentChargeId: "charge:usd" }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await ctx.db.select().from(payments)).toHaveLength(0);
  });

  it("rejects a payment that belongs to another Telegram account", async () => {
    const user = await createUser(ctx.db);
    const settings = testSettings();

    await expect(
      creditSuccessfulPayment(ctx.db, settings, paymentInput(user.id, user.telegramId + 1), NOW),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await ctx.db.select().from(payments)).toHaveLength(0);
  });

  it("rejects malformed invoice payloads", async () => {
    const user = await createUser(ctx.db);
    const settings = testSettings();

    for (const payload of ["", "coins", "coins:pack_100k", "gift:pack_100k:1:x", "coins:pack_100k:0:x"]) {
      await expect(
        creditSuccessfulPayment(
          ctx.db,
          settings,
          paymentInput(user.id, user.telegramId, { invoicePayload: payload }),
          NOW,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("rejects an unknown pack id", async () => {
    const user = await createUser(ctx.db);
    const settings = testSettings();

    await expect(
      creditSuccessfulPayment(
        ctx.db,
        settings,
        paymentInput(user.id, user.telegramId, { invoicePayload: `coins:missing:${user.id}:nonce` }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to credit a pack that has become arbitrageable", async () => {
    const user = await createUser(ctx.db);
    const bad = testSettings({ economy: { coin_packs: [{ id: "bad", coins: 100_000, stars: 5 }] } });

    await expect(
      creditSuccessfulPayment(
        ctx.db,
        bad,
        paymentInput(user.id, user.telegramId, { invoicePayload: `coins:bad:${user.id}:nonce`, totalAmount: 5 }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: "CONFIG_ERROR" });

    expect(await ctx.db.select().from(payments)).toHaveLength(0);
    expect(await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id))).toHaveLength(0);
  });
});
