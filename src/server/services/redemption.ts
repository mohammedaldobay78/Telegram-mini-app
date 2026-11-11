import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { adminAudit, adViews, dailyActivity, redemptions, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { utcDateKey } from "@/lib/dates";
import { logger } from "@/lib/logger";
import type { Settings } from "@/server/config/settings";
import { countActiveDays } from "@/server/economy/activity";
import { hasEntry, post } from "@/server/economy/ledger";
import { giftPrice, isGiftTier, type GiftTier } from "@/server/economy/pricing";
import { checkRedemptionEligibility, globalBudgetAllows } from "@/server/security/gate";
import type { UserRow } from "@/server/services/users";
import { accountAgeDays } from "@/server/services/users";
import { resolveGiftId } from "@/server/telegram/gifts";
import { notifyAdmins, notifyUser } from "@/server/telegram/notify";
import { adminCallbackData } from "@/server/telegram/sign";
import { getMyStarBalance, sendGift } from "@/server/telegram/api";

const CAP_STATES = ["approved", "sent", "delivered"] as const;

export interface RedemptionView {
  id: number;
  giftId: string;
  coins: number;
  stars: number;
  status: string;
  duplicate: boolean;
}

async function starsSpentSince(db: Database, userId: number, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: sql<string>`coalesce(sum(${redemptions.stars}), 0)` })
    .from(redemptions)
    .where(
      and(
        eq(redemptions.userId, userId),
        inArray(redemptions.status, [...CAP_STATES]),
        gte(redemptions.createdAt, since),
      ),
    );
  return Number(row?.value ?? 0);
}

async function trailingAdRevenueMicro(db: Database, settings: Settings, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: sql<string>`count(*)` })
    .from(adViews)
    .where(and(eq(adViews.rewarded, true), gte(adViews.createdAt, since)));
  return Number(row?.value ?? 0) * settings.economy.ad_revenue_micro;
}

/** PLAN §9.2 + §9.5. */
export async function requestRedemption(
  db: Database,
  user: UserRow,
  settings: Settings,
  tier: GiftTier,
  idempotencyKey: string,
  now: Date,
): Promise<RedemptionView> {
  if (!settings.flags.payouts) {
    throw new AppError("KILL_SWITCHED", "Payouts are temporarily paused", { retryable: true, details: { flag: "payouts" } });
  }

  const existing = await db
    .select()
    .from(redemptions)
    .where(and(eq(redemptions.userId, user.id), eq(redemptions.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (existing[0]) {
    const row = existing[0];
    return { id: row.id, giftId: row.giftId, coins: Number(row.coins), stars: row.stars, status: row.status, duplicate: true };
  }

  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  const monthStart = new Date(now.getTime() - 30 * 86_400_000);

  const [tapsRow, weeklyStars, monthlyStars, openRow, deliveredRow, activeDays, adRevenue] = await Promise.all([
    db
      .select({ value: sql<string>`coalesce(sum(${dailyActivity.taps}), 0)` })
      .from(dailyActivity)
      .where(eq(dailyActivity.userId, user.id)),
    starsSpentSince(db, user.id, weekStart),
    starsSpentSince(db, user.id, monthStart),
    db
      .select({ value: sql<string>`count(*)` })
      .from(redemptions)
      .where(
        and(
          eq(redemptions.userId, user.id),
          inArray(redemptions.status, ["requested", "approved", "sent", "failed"]),
        ),
      ),
    db
      .select({ value: sql<string>`count(*)` })
      .from(redemptions)
      .where(and(eq(redemptions.userId, user.id), eq(redemptions.status, "delivered"))),
    countActiveDays(db, user.id),
    trailingAdRevenueMicro(db, settings, monthStart),
  ]);

  const deliveredCount = Number(deliveredRow[0]?.value ?? 0);

  if (tier === "standard" && deliveredCount < 1) {
    throw new AppError("FORBIDDEN", "Standard gift unlocks after your first delivery");
  }
  if (tier === "premium" && activeDays < 30) {
    throw new AppError("FORBIDDEN", "Premium gift unlocks after 30 days of activity");
  }

  const eligibility = checkRedemptionEligibility({
    settings: settings.payouts,
    tier,
    accountAgeDays: accountAgeDays(user.createdAt, now),
    lifetimeTaps: Number(tapsRow[0]?.value ?? 0),
    lifetimeAdViews: user.lifetimeAdViews,
    estRevenueMicro: Number(user.estRevenueMicro),
    hasOpenRedemption: Number(openRow[0]?.value ?? 0) > 0,
    weeklyStars,
    monthlyStars,
    riskFlags: user.riskFlags as Record<string, unknown>,
    balance: Number(user.balance),
  });

  if (!eligibility.ok) {
    throw new AppError("FORBIDDEN", "Redemption requirements are not met", {
      details: { issues: eligibility.issues },
    });
  }

  if (
    !globalBudgetAllows({
      settings: settings.payouts,
      trailing30dAdRevenueMicro: adRevenue,
      starsSpentLast30d: 0,
      nextStars: eligibility.stars,
    })
  ) {
    throw new AppError("KILL_SWITCHED", "Global payout budget reached; the queue is paused", {
      retryable: true,
    });
  }

  // Live catalog lookup happens before the money transaction; a catalog failure
  // must not lock coins.
  const telegramGiftId = await resolveGiftId(settings, tier);

  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");

    const [openCount] = await tx
      .select({ value: sql<string>`count(*)` })
      .from(redemptions)
      .where(
        and(
          eq(redemptions.userId, user.id),
          inArray(redemptions.status, ["requested", "approved", "sent", "failed"]),
        ),
      );
    if (Number(openCount?.value ?? 0) > 0) {
      throw new AppError("CONFLICT", "You already have a redemption in progress");
    }

    if (await hasEntry(tx, user.id, `redeem:${idempotencyKey}`)) {
      throw new AppError("CONFLICT", "Redemption request replay");
    }

    const [created] = await tx
      .insert(redemptions)
      .values({
        userId: user.id,
        coins: eligibility.coins,
        giftId: telegramGiftId,
        stars: eligibility.stars,
        status: "requested",
        idempotencyKey,
      })
      .returning();
    if (!created) throw new AppError("INTERNAL_ERROR", "Failed to create redemption");

    await post(tx, {
      userId: user.id,
      delta: -eligibility.coins,
      type: "redemption_lock",
      refId: String(created.id),
      idempotencyKey: `redeem:${idempotencyKey}`,
      momentum: Number(locked.momentum),
      meta: { giftId: telegramGiftId, tier, stars: eligibility.stars },
    });

    return created;
  });

  const price = giftPrice(settings.payouts, tier);
  try {
    await notifyAdmins(
      [
        "Redemption request",
        `User: ${user.firstName ?? "unknown"} (@${user.username ?? "-"}) id=${user.telegramId}`,
        `Gift: ${tier} — ${price.stars} Stars (${price.coins} coins)`,
        `30d revenue (est): $${(Number(user.estRevenueMicro) / 1_000_000).toFixed(4)}`,
        `Risk flags: ${Object.keys(user.riskFlags as Record<string, unknown>).join(", ") || "none"}`,
        `Redemption #${result.id}`,
      ].join("\n"),
      {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: adminCallbackData(result.id, "approve", now) },
            { text: "Reject", callback_data: adminCallbackData(result.id, "reject", now) },
          ],
        ],
      },
    );
  } catch (error) {
    // The redemption is already committed and the coins are locked. A failed
    // admin notification must never turn that into a 500 for the user.
    logger.warn("redemption_notify_failed", { redemptionId: result.id, error: String(error) });
  }

  return {
    id: result.id,
    giftId: result.giftId,
    coins: Number(result.coins),
    stars: result.stars,
    status: result.status,
    duplicate: false,
  };
}

export interface AdminDecisionResult {
  id: number;
  status: string;
}

/** PLAN §9.3: approve/reject with audit trail and coin release on reject. */
export async function adminDecideRedemption(
  db: Database,
  redemptionId: number,
  action: "approve" | "reject",
  adminTelegramId: number,
  settings: Settings,
  now: Date,
): Promise<AdminDecisionResult> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(redemptions).where(eq(redemptions.id, redemptionId)).for("update").limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Redemption not found");
    if (row.status !== "requested") {
      throw new AppError("CONFLICT", `Redemption is already ${row.status}`);
    }

    if (action === "approve") {
      if (!settings.flags.payouts) {
        throw new AppError("KILL_SWITCHED", "Payouts are paused");
      }
      const weekStart = new Date(now.getTime() - 7 * 86_400_000);
      const monthStart = new Date(now.getTime() - 30 * 86_400_000);
      const [weekly, monthly] = await Promise.all([
        starsSpentSince(tx as unknown as Database, row.userId, weekStart),
        starsSpentSince(tx as unknown as Database, row.userId, monthStart),
      ]);
      if (weekly + row.stars > settings.payouts.weekly_cap_stars) {
        throw new AppError("DAILY_CAP_REACHED", "Weekly cap would be exceeded");
      }
      if (monthly + row.stars > settings.payouts.monthly_cap_stars) {
        throw new AppError("DAILY_CAP_REACHED", "Monthly cap would be exceeded");
      }
      await tx
        .update(redemptions)
        .set({ status: "approved", updatedAt: now })
        .where(eq(redemptions.id, row.id));
    } else {
      await tx
        .update(redemptions)
        .set({ status: "rejected", updatedAt: now })
        .where(eq(redemptions.id, row.id));
      await post(tx, {
        userId: row.userId,
        delta: Number(row.coins),
        type: "redemption_refund",
        refId: String(row.id),
        idempotencyKey: `redemption_refund:${row.id}`,
        meta: { reason: "admin_reject" },
      });
    }

    await tx.insert(adminAudit).values({
      adminId: adminTelegramId,
      action: `redemption.${action}`,
      payload: { redemptionId: row.id, userId: row.userId, stars: row.stars },
    });

    return { id: row.id, status: action === "approve" ? "approved" : "rejected", userId: row.userId };
  });

  const [target] = await db.select({ telegramId: users.telegramId }).from(users).where(eq(users.id, result.userId)).limit(1);
  if (target) {
    await notifyUser(
      target.telegramId,
      action === "approve"
        ? "Your redemption was approved. The gift will be delivered shortly."
        : "Your redemption was rejected. Your coins have been returned.",
    );
  }

  return { id: result.id, status: result.status };
}

export interface PayoutRunResult {
  sent: number;
  failed: number;
  skipped: number;
  starsBalance: number | null;
}

/** PLAN §9.3–9.4 + §4.5 payout cron. */
export async function processPayoutQueue(
  db: Database,
  settings: Settings,
  now: Date,
): Promise<PayoutRunResult> {
  if (!settings.flags.payouts) {
    return { sent: 0, failed: 0, skipped: 0, starsBalance: null };
  }

  let starsBalance: number | null = null;
  try {
    starsBalance = await getMyStarBalance();
  } catch {
    await notifyAdmins("Payout queue: cannot read bot Stars balance. Queue paused.", undefined).catch(() => undefined);
    return { sent: 0, failed: 0, skipped: 1, starsBalance: null };
  }

  const queue = await db
    .select()
    .from(redemptions)
    .where(eq(redemptions.status, "approved"))
    .orderBy(redemptions.createdAt)
    .for("update", { skipLocked: true })
    .limit(10);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const redemption of queue) {
    if (starsBalance < redemption.stars) {
      skipped += 1;
      continue;
    }

    const [user] = await db.select().from(users).where(eq(users.id, redemption.userId)).limit(1);
    if (!user) {
      skipped += 1;
      continue;
    }

    // Claim the row before calling Telegram. If the process dies between the
    // API call and the update below, the row stays `sent` instead of being
    // retried, so a gift can never be sent twice. Stale `sent` rows are
    // surfaced by cron/reconcile for manual reconciliation.
    const [claimed] = await db
      .update(redemptions)
      .set({ status: "sent", error: null, updatedAt: now })
      .where(and(eq(redemptions.id, redemption.id), eq(redemptions.status, "approved")))
      .returning({ id: redemptions.id });
    if (!claimed) {
      skipped += 1;
      continue;
    }

    try {
      await sendGift({
        userId: user.telegramId,
        giftId: redemption.giftId,
        text: "Your Earn Money reward",
      });
      starsBalance -= redemption.stars;
      await db
        .update(redemptions)
        .set({ status: "delivered", error: null, updatedAt: now })
        .where(and(eq(redemptions.id, redemption.id), eq(redemptions.status, "sent")));
      sent += 1;
      await notifyUser(user.telegramId, "Your gift has been delivered 🎁");
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message.slice(0, 300) : "sendGift failed";
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(redemptions)
          .set({ status: "failed", error: reason, updatedAt: now })
          .where(and(eq(redemptions.id, redemption.id), eq(redemptions.status, "sent")))
          .returning({ id: redemptions.id });
        if (!updated) return;
        await post(tx, {
          userId: redemption.userId,
          delta: Number(redemption.coins),
          type: "redemption_refund",
          refId: String(redemption.id),
          idempotencyKey: `redemption_refund:${redemption.id}`,
          meta: { reason: "delivery_failed" },
        });
      });
      await notifyUser(
        user.telegramId,
        "Your gift could not be delivered. Your coins have been refunded automatically.",
      );
      await notifyAdmins(
        `Gift delivery failed for redemption #${redemption.id}: ${reason}. Coins were refunded.`,
      ).catch(() => undefined);
    }
  }

  return { sent, failed, skipped, starsBalance };
}
