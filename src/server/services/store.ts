import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { adTickets, adViews, upgrades, users, workers } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { nextUtcMidnight, utcDateKey } from "@/lib/dates";
import type { Settings } from "@/server/config/settings";
import type { StoreKind, WorkerHours, WorkerTier } from "@/lib/types";
import { recordActivity } from "@/server/economy/activity";
import { computeEnergy, energyCap } from "@/server/economy/energy";
import { hasEntry, post } from "@/server/economy/ledger";
import {
  consumableDurationSeconds,
  consumablePrice,
  maxLevel,
  upgradeCost,
} from "@/server/economy/store";
import type { UserRow } from "@/server/services/users";
import { getUpgradeLevels } from "@/server/services/users";

export interface PurchaseResult {
  kind: StoreKind;
  cost: number;
  balance: number;
  duplicate: boolean;
  level?: number;
  expiresAt?: string;
}

export async function purchaseStoreItem(
  db: Database,
  user: UserRow,
  settings: Settings,
  kind: StoreKind,
  idempotencyKey: string,
  now: Date,
): Promise<PurchaseResult> {
  if (!settings.flags.store) {
    throw new AppError("KILL_SWITCHED", "The store is temporarily disabled", { retryable: true, details: { flag: "store" } });
  }

  const today = utcDateKey(now);
  const ledgerKey = `store:${user.id}:${idempotencyKey}`;

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");

    if (await hasEntry(tx, user.id, ledgerKey)) {
      return { kind, cost: 0, balance: Number(locked.balance), duplicate: true };
    }

    if (kind === "tap_power" || kind === "energy_cap" || kind === "regen") {
      const levels = await getUpgradeLevels(tx, user.id);
      const currentLevel = levels[kind];
      if (currentLevel >= maxLevel(settings.economy, kind)) {
        throw new AppError("CONFLICT", "Upgrade is already at max level");
      }
      const cost = upgradeCost(settings.economy, kind, currentLevel);
      const result = await post(tx, {
        userId: user.id,
        delta: -cost,
        type: "store_purchase",
        refId: kind,
        idempotencyKey: ledgerKey,
        meta: { kind, level: currentLevel + 1 },
      });

      await tx
        .insert(upgrades)
        .values({ userId: user.id, kind, level: currentLevel + 1 })
        .onConflictDoUpdate({
          target: [upgrades.userId, upgrades.kind],
          set: { level: sql`${upgrades.level} + 1` },
        });

      await recordActivity(tx, user.id, today, { purchases: 1 });
      return { kind, cost, balance: result.balance, duplicate: false, level: currentLevel + 1 };
    }

    if (kind === "full_energy") {
      const levels = await getUpgradeLevels(tx, user.id);
      const snapshot = computeEnergy(
        settings.economy,
        { energyCapLevel: levels.energy_cap, regenLevel: levels.regen },
        locked.energy,
        locked.energyUpdatedAt,
        now,
      );
      if (snapshot.energy >= snapshot.cap) {
        throw new AppError("CONFLICT", "Energy is already full");
      }
      const cost = consumablePrice(settings.economy, "full_energy");
      const result = await post(tx, {
        userId: user.id,
        delta: -cost,
        type: "store_purchase",
        refId: kind,
        idempotencyKey: ledgerKey,
        meta: { kind },
      });
      await tx
        .update(users)
        .set({ energy: energyCap(settings.economy, levels.energy_cap), energyUpdatedAt: now, updatedAt: now })
        .where(eq(users.id, user.id));
      await recordActivity(tx, user.id, today, { purchases: 1 });
      return { kind, cost, balance: result.balance, duplicate: false };
    }

    if (kind === "double_tap" || kind === "auto_tap") {
      const cost = consumablePrice(settings.economy, kind);
      const duration = consumableDurationSeconds(settings.economy, kind);
      const expiresAt = new Date(now.getTime() + duration * 1000);
      const result = await post(tx, {
        userId: user.id,
        delta: -cost,
        type: "store_purchase",
        refId: kind,
        idempotencyKey: ledgerKey,
        meta: { kind, expiresAt: expiresAt.toISOString() },
      });
      const patch =
        kind === "double_tap"
          ? { double_tap_until: expiresAt.toISOString() }
          : { auto_tap_until: expiresAt.toISOString() };
      await tx
        .update(users)
        .set({
          activeBuffs: sql`coalesce(${users.activeBuffs}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
      await recordActivity(tx, user.id, today, { purchases: 1 });
      return { kind, cost, balance: result.balance, duplicate: false, expiresAt: expiresAt.toISOString() };
    }

    // ad_ticket
    const dayStart = new Date(`${today}T00:00:00.000Z`);
    const [adsRow] = await tx
      .select({ value: sql<string>`count(*)` })
      .from(adViews)
      .where(
        and(eq(adViews.userId, user.id), eq(adViews.rewarded, true), gte(adViews.createdAt, dayStart)),
      );
    const watched = Number(adsRow?.value ?? 0);
    if (watched < settings.economy.free_ads_per_day) {
      throw new AppError("CONFLICT", "Use your free ads before buying a ticket");
    }

    const cost = settings.economy.extra_ad_slot_price;
    const result = await post(tx, {
      userId: user.id,
      delta: -cost,
      type: "store_purchase",
      refId: "ad_ticket",
      idempotencyKey: ledgerKey,
      meta: { kind },
    });
    const expiresAt = nextUtcMidnight(now);
    await tx.insert(adTickets).values({
      userId: user.id,
      nonce: `ticket_${crypto.randomUUID()}`,
      pricePaid: cost,
      expiresAt,
    });
    await recordActivity(tx, user.id, today, { purchases: 1 });
    return { kind, cost, balance: result.balance, duplicate: false, expiresAt: expiresAt.toISOString() };
  });
}

export interface RentResult {
  cost: number;
  balance: number;
  duplicate: boolean;
  workerId: number;
  endsAt: string;
}

export async function rentWorkerService(
  db: Database,
  user: UserRow,
  settings: Settings,
  tier: WorkerTier,
  hours: WorkerHours,
  idempotencyKey: string,
  now: Date,
): Promise<RentResult> {
  if (!settings.flags.store) {
    throw new AppError("KILL_SWITCHED", "The store is temporarily disabled", { retryable: true });
  }

  const ledgerKey = `worker_rent:${user.id}:${idempotencyKey}`;
  const perHour = settings.economy.worker_rent_per_hour[tier - 1];
  if (perHour === undefined) throw new AppError("VALIDATION_ERROR", "Unknown worker tier");
  const cost = perHour * hours;
  const endsAt = new Date(now.getTime() + hours * 3_600_000);

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");

    if (await hasEntry(tx, user.id, ledgerKey)) {
      return { cost: 0, balance: Number(locked.balance), duplicate: true, workerId: 0, endsAt: endsAt.toISOString() };
    }

    const result = await post(tx, {
      userId: user.id,
      delta: -cost,
      type: "worker_rent",
      refId: `${tier}:${hours}`,
      idempotencyKey: ledgerKey,
      meta: { tier, hours },
    });

    const [worker] = await tx
      .insert(workers)
      .values({ userId: user.id, tier, rentalStartedAt: now, rentalEndsAt: endsAt })
      .returning({ id: workers.id });

    await recordActivity(tx, user.id, utcDateKey(now), { workersRented: 1 });

    return {
      cost,
      balance: result.balance,
      duplicate: false,
      workerId: Number(worker?.id ?? 0),
      endsAt: endsAt.toISOString(),
    };
  });
}
