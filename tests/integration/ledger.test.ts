import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { transactions, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { post } from "@/server/economy/ledger";
import { createUser, makeTestDb, type TestDb } from "../helpers/db";

describe("ledger.post", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await makeTestDb();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("credits the balance and lifetime earnings inside a transaction", async () => {
    const user = await createUser(ctx.db);
    const result = await ctx.db.transaction((tx) =>
      post(tx, {
        userId: user.id,
        delta: 1_000,
        type: "tap",
        idempotencyKey: "tap:test:1",
      }),
    );

    expect(result.balance).toBe(1_000);
    expect(result.lifetimeCoinsEarned).toBe(1_000);
    expect(result.duplicate).toBe(false);

    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(Number(row?.balance)).toBe(1_000);
  });

  it("is idempotent for a repeated key with the same payload", async () => {
    const user = await createUser(ctx.db);
    const entry = {
      userId: user.id,
      delta: 500,
      type: "ad" as const,
      idempotencyKey: "ad:test:same",
    };

    const first = await ctx.db.transaction((tx) => post(tx, entry));
    const second = await ctx.db.transaction((tx) => post(tx, entry));

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.balance).toBe(500);

    const rows = await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects the same key with a different payload", async () => {
    const user = await createUser(ctx.db);
    await ctx.db.transaction((tx) =>
      post(tx, { userId: user.id, delta: 500, type: "ad", idempotencyKey: "ad:conflict" }),
    );

    await expect(
      ctx.db.transaction((tx) =>
        post(tx, { userId: user.id, delta: 900, type: "ad", idempotencyKey: "ad:conflict" }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses to go below zero and leaves the ledger unchanged", async () => {
    const user = await createUser(ctx.db, { balance: 100 });

    const error = await ctx.db
      .transaction((tx) =>
        post(tx, { userId: user.id, delta: -101, type: "store_purchase", idempotencyKey: "buy:test:1" }),
      )
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("INSUFFICIENT_FUNDS");

    const rows = await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id));
    expect(rows).toHaveLength(0);
  });

  it("never decreases lifetime earnings on spend", async () => {
    const user = await createUser(ctx.db, { balance: 10_000 });
    await ctx.db.transaction((tx) =>
      post(tx, { userId: user.id, delta: 10_000, type: "daily", idempotencyKey: "daily:test:1" }),
    );
    const result = await ctx.db.transaction((tx) =>
      post(tx, { userId: user.id, delta: -4_000, type: "store_purchase", idempotencyKey: "buy:test:2" }),
    );

    expect(result.balance).toBe(16_000);
    expect(result.lifetimeCoinsEarned).toBe(10_000);
  });

  it("requires an idempotency key for non-tap entries", async () => {
    const user = await createUser(ctx.db);
    await expect(
      ctx.db.transaction((tx) => post(tx, { userId: user.id, delta: 10, type: "ad" })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("keeps balance equal to the ledger sum under concurrency", async () => {
    const user = await createUser(ctx.db);
    const credits = Array.from({ length: 20 }, (_, index) => index + 1);

    await Promise.all(
      credits.map((amount) =>
        ctx.db.transaction((tx) =>
          post(tx, {
            userId: user.id,
            delta: amount,
            type: "tap",
            idempotencyKey: `tap:concurrent:${amount}`,
          }),
        ),
      ),
    );

    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    const rows = await ctx.db.select().from(transactions).where(eq(transactions.userId, user.id));
    const sum = rows.reduce((total, entry) => total + Number(entry.delta), 0);

    expect(rows).toHaveLength(20);
    expect(Number(row?.balance)).toBe(sum);
    expect(sum).toBe((20 * 21) / 2);
  });
});
