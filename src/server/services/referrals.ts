import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { anomalies, dailyActivity, referrals, transactions, users } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { Settings } from "@/server/config/settings";
import { post } from "@/server/economy/ledger";

const DAY_MS = 86_400_000;

export interface ReferralApplication {
  code: string;
  inviteeId: number;
  ipHash: string | null;
}

/**
 * Creates a referral row on first auth (PLAN §7.4). Self-referrals and
 * existing referrers are rejected silently so a user cannot learn which
 * codes exist.
 */
export async function applyReferral(
  db: Database,
  inviteeId: number,
  code: string,
  ipHash: string | null,
): Promise<boolean> {
  const [referrer] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
  if (!referrer || referrer.id === inviteeId) return false;

  const [invitee] = await db.select({ referredBy: users.referredBy }).from(users).where(eq(users.id, inviteeId)).limit(1);
  if (!invitee || invitee.referredBy) return false;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(referrals).values({
        referrerId: referrer.id,
        inviteeId,
        signupIpHash: ipHash,
      });
      await tx.update(users).set({ referredBy: referrer.id }).where(eq(users.id, inviteeId));
    });
    return true;
  } catch {
    return false;
  }
}

interface ReferralPayoutResult {
  paid: number;
  qualified: boolean;
  skipped: string | null;
}

/**
 * Pays 10% of an invitee's earnings to the referrer (PLAN §2.8), in a separate
 * transaction after the earning one so row-lock order can never deadlock.
 */
export async function payReferralCommission(
  db: Database,
  inviteeId: number,
  earnedCoins: number,
  sourceKey: string,
  settings: Settings,
  now: Date,
): Promise<ReferralPayoutResult> {
  if (earnedCoins <= 0) return { paid: 0, qualified: false, skipped: "NO_EARNINGS" };

  const [invitee] = await db.select().from(users).where(eq(users.id, inviteeId)).limit(1);
  if (!invitee || !invitee.referredBy) return { paid: 0, qualified: false, skipped: "NO_REFERRER" };

  const [referral] = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.inviteeId, inviteeId), eq(referrals.referrerId, invitee.referredBy)))
    .limit(1);
  if (!referral) return { paid: 0, qualified: false, skipped: "NO_REFERRAL_ROW" };

  const qualification = settings.payouts.referral_qualification;
  const accountAgeDays = Math.floor((now.getTime() - invitee.createdAt.getTime()) / DAY_MS);
  const [tapsRow] = await db
    .select({ value: sql<string>`coalesce(sum(${dailyActivity.taps}), 0)` })
    .from(dailyActivity)
    .where(eq(dailyActivity.userId, inviteeId));
  const lifetimeTaps = Number(tapsRow?.value ?? 0);

  const qualifies =
    accountAgeDays >= qualification.min_age_days &&
    lifetimeTaps >= qualification.min_taps &&
    invitee.lifetimeAdViews >= qualification.min_ad_views &&
    Number(invitee.estRevenueMicro) >= qualification.min_revenue_micro;

  if (!qualifies) return { paid: 0, qualified: false, skipped: "NOT_QUALIFIED" };

  const delayMs = settings.payouts.referral_payout_delay_hours * 3_600_000;
  if (now.getTime() - referral.createdAt.getTime() < delayMs) {
    return { paid: 0, qualified: false, skipped: "DELAY" };
  }

  // Referral farm cluster check (PLAN §10.4). Freeze, never auto-ban.
  if (referral.signupIpHash) {
    const [clusterRow] = await db
      .select({ value: sql<string>`count(*)` })
      .from(referrals)
      .where(
        and(
          eq(referrals.signupIpHash, referral.signupIpHash),
          gte(referrals.createdAt, new Date(now.getTime() - DAY_MS)),
        ),
      );
    if (Number(clusterRow?.value ?? 0) >= 5) {
      await db.insert(anomalies).values({
        userId: inviteeId,
        kind: "REFERRAL_CLUSTER",
        payload: { referrerId: invitee.referredBy, ipHash: referral.signupIpHash },
      });
      return { paid: 0, qualified: true, skipped: "CLUSTER_FROZEN" };
    }
  }

  const [activeRow] = await db
    .select({ value: sql<string>`count(*)` })
    .from(referrals)
    .where(and(eq(referrals.referrerId, invitee.referredBy), eq(referrals.qualified, true)));
  if (Number(activeRow?.value ?? 0) >= settings.economy.referral_max_active) {
    return { paid: 0, qualified: true, skipped: "MAX_ACTIVE" };
  }

  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [todayRow] = await db
    .select({ value: sql<string>`coalesce(sum(${transactions.delta}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, invitee.referredBy),
        eq(transactions.type, "referral"),
        gte(transactions.createdAt, dayStart),
      ),
    );
  const remainingCap = Math.max(0, settings.economy.referral_daily_cap - Number(todayRow?.value ?? 0));
  if (remainingCap <= 0) return { paid: 0, qualified: true, skipped: "DAILY_CAP" };

  const rawCommission = Math.floor(earnedCoins * settings.economy.referral_rate);
  const commission = Math.min(rawCommission, remainingCap);
  if (commission <= 0) return { paid: 0, qualified: true, skipped: "ROUNDS_TO_ZERO" };

  const safeKey = `${inviteeId}:${createHash("sha256").update(sourceKey).digest("hex").slice(0, 32)}`;

  try {
    await db.transaction(async (tx) => {
      if (!referral.qualified) {
        await tx
          .update(referrals)
          .set({ qualified: true })
          .where(and(eq(referrals.referrerId, referral.referrerId), eq(referrals.inviteeId, referral.inviteeId)));
      }
      await post(tx, {
        userId: invitee.referredBy as number,
        delta: commission,
        type: "referral",
        refId: String(inviteeId),
        idempotencyKey: `ref:${safeKey}`,
        meta: { inviteeId, sourceKey: sourceKey.slice(0, 120), rate: settings.economy.referral_rate },
      });
    });
    return { paid: commission, qualified: true, skipped: null };
  } catch (error) {
    logger.error("referral_payout_failed", { inviteeId, error: String(error) });
    return { paid: 0, qualified: true, skipped: "ERROR" };
  }
}
