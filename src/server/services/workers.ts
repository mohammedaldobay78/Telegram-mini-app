import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { users, workers } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { utcDateKey } from "@/lib/dates";
import type { Settings } from "@/server/config/settings";
import { recordActivity } from "@/server/economy/activity";
import { hasEntry, post } from "@/server/economy/ledger";
import { accrueAll } from "@/server/economy/workers";
import type { UserRow } from "@/server/services/users";

export interface CollectResult {
  collected: number;
  balance: number;
  duplicate: boolean;
  workers: { id: number; coins: number; capped: boolean }[];
}

/** PLAN §2.6: server-clock accrual, 8 h cap, collected only on open. */
export async function collectWorkers(
  db: Database,
  user: UserRow,
  settings: Settings,
  momentum: number,
  idempotencyKey: string,
  now: Date,
): Promise<CollectResult> {
  const key = `worker_collect:${user.id}:${idempotencyKey}`;

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");

    if (await hasEntry(tx, user.id, key)) {
      return { collected: 0, balance: Number(locked.balance), duplicate: true, workers: [] };
    }

    const rows = await tx.select().from(workers).where(eq(workers.userId, user.id)).for("update");
    const accrue = accrueAll(
      settings.economy,
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        tier: row.tier,
        rentalStartedAt: row.rentalStartedAt,
        rentalEndsAt: row.rentalEndsAt,
        lastCollectedAt: row.lastCollectedAt,
      })),
      momentum,
      now,
    );

    if (accrue.total <= 0) {
      return { collected: 0, balance: Number(locked.balance), duplicate: false, workers: [] };
    }

    const result = await post(tx, {
      userId: user.id,
      delta: accrue.total,
      type: "worker_collect",
      refId: utcDateKey(now),
      idempotencyKey: key,
      momentum,
      meta: { workers: accrue.rows.map((row) => ({ id: row.workerId, coins: row.coins, hours: row.hours })) },
    });

    for (const row of accrue.rows) {
      await tx
        .update(workers)
        .set({ lastCollectedAt: row.accrualEnd })
        .where(eq(workers.id, row.workerId));
    }

    await recordActivity(tx, user.id, utcDateKey(now), {
      coinsEarned: accrue.total,
      momentumSnapshot: momentum,
    });

    return {
      collected: accrue.total,
      balance: result.balance,
      duplicate: false,
      workers: accrue.rows.map((row) => ({ id: row.workerId, coins: row.coins, capped: row.capped })),
    };
  });
}

export async function expireWorkers(db: Database, now: Date): Promise<number> {
  const result = await db.delete(workers).where(sql`${workers.rentalEndsAt} < ${now}`);
  return Array.isArray(result) ? result.length : 0;
}
