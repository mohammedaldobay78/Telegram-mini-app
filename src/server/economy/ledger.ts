import { and, eq, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";
import { transactions, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { ledgerEntrySchema } from "@/lib/schemas";
import { LIFETIME_EARNING_TYPES, type LedgerEntryInput } from "@/lib/types";

export interface PostResult {
  balance: number;
  lifetimeCoinsEarned: number;
  transactionId: number;
  duplicate: boolean;
}

/**
 * The only function allowed to mutate a balance (PLAN §5.2, §10.2).
 *
 * Contract:
 *  - must run inside a DB transaction;
 *  - takes `SELECT ... FOR UPDATE` on the user row;
 *  - requires an idempotency key for every non-tap entry;
 *  - rejects negative balances;
 *  - appends an immutable ledger row carrying the momentum snapshot.
 */
export async function post(tx: DbTransaction, input: LedgerEntryInput): Promise<PostResult> {
  const entry = ledgerEntrySchema.parse(input);

  if (entry.type !== "tap" && !entry.idempotencyKey) {
    throw new AppError("VALIDATION_ERROR", `idempotencyKey is required for ${entry.type}`);
  }

  const [user] = await tx
    .select({
      id: users.id,
      balance: users.balance,
      lifetimeCoinsEarned: users.lifetimeCoinsEarned,
      isBanned: users.isBanned,
    })
    .from(users)
    .where(eq(users.id, entry.userId))
    .for("update")
    .limit(1);

  if (!user) throw new AppError("NOT_FOUND", "User not found");
  if (user.isBanned) throw new AppError("FORBIDDEN", "Account is restricted");

  if (entry.idempotencyKey) {
    const [existing] = await tx
      .select({
        id: transactions.id,
        userId: transactions.userId,
        delta: transactions.delta,
        type: transactions.type,
      })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, entry.idempotencyKey))
      .limit(1);

    if (existing) {
      if (existing.userId !== entry.userId || existing.delta !== entry.delta || existing.type !== entry.type) {
        throw new AppError("CONFLICT", "Idempotency key was already used with a different payload");
      }
      return {
        balance: Number(user.balance),
        lifetimeCoinsEarned: Number(user.lifetimeCoinsEarned),
        transactionId: Number(existing.id),
        duplicate: true,
      };
    }
  }

  const balance = Number(user.balance) + entry.delta;
  if (balance < 0) {
    throw new AppError("INSUFFICIENT_FUNDS", "Not enough coins for this operation", {
      details: { balance: Number(user.balance), required: Math.abs(entry.delta) },
    });
  }

  const lifetimeCoinsEarned =
    Number(user.lifetimeCoinsEarned) +
    (entry.delta > 0 && LIFETIME_EARNING_TYPES.has(entry.type) ? entry.delta : 0);

  await tx
    .update(users)
    .set({ balance, lifetimeCoinsEarned, updatedAt: new Date() })
    .where(eq(users.id, entry.userId));

  const [inserted] = await tx
    .insert(transactions)
    .values({
      userId: entry.userId,
      delta: entry.delta,
      type: entry.type,
      refId: entry.refId ?? null,
      idempotencyKey: entry.idempotencyKey ?? null,
      momentum: entry.momentum !== undefined ? entry.momentum.toFixed(2) : null,
      meta: entry.meta,
    })
    .returning({ id: transactions.id });

  if (!inserted) throw new AppError("INTERNAL_ERROR", "Ledger insert returned no row");

  return {
    balance,
    lifetimeCoinsEarned,
    transactionId: Number(inserted.id),
    duplicate: false,
  };
}

export async function getBalance(tx: DbTransaction, userId: number): Promise<number> {
  const [row] = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new AppError("NOT_FOUND", "User not found");
  return Number(row.balance);
}

export async function hasEntry(tx: DbTransaction, userId: number, idempotencyKey: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.idempotencyKey, idempotencyKey)))
    .limit(1);
  return Boolean(row);
}

/** Audit helper used by the reconciliation cron (PLAN §2.12.1). */
export async function ledgerSum(tx: DbTransaction, userId: number): Promise<number> {
  const [row] = await tx
    .select({ sum: sql<string>`coalesce(sum(${transactions.delta}), 0)` })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  return Number(row?.sum ?? 0);
}
