import { and, eq, gte } from "drizzle-orm";
import type { Database } from "@/db/client";
import { dailyActivity, transactions, usedNonces, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { utcDateKey } from "@/lib/dates";
import type { TapRequest } from "@/lib/schemas";
import type { MomentumComponents } from "@/lib/types";
import type { Settings } from "@/server/config/settings";
import { recordActivity } from "@/server/economy/activity";
import { consumeEnergy, computeEnergy } from "@/server/economy/energy";
import { hasEntry, post } from "@/server/economy/ledger";
import { applyMacroPenalty } from "@/server/economy/momentum";
import { tapReward } from "@/server/economy/store";
import { assessTapBatch } from "@/server/security/anomaly";
import { anomalies } from "@/db/schema";
import type { UserRow } from "@/server/services/users";
import { getUpgradeLevels } from "@/server/services/users";

export interface TapResult {
  taps: number;
  reward: number;
  balance: number;
  energy: number;
  energyCap: number;
  momentum: MomentumComponents;
  flagged: boolean;
  flagReasons: string[];
  duplicate: boolean;
  signupBonus: number;
}

/** PLAN §2.2 tap loop, §10.3 anti-macro controls. */
export async function performTapBatch(
  db: Database,
  user: UserRow,
  settings: Settings,
  input: TapRequest,
  momentumInput: MomentumComponents,
  now: Date,
): Promise<TapResult> {
  const assessment = assessTapBatch({
    taps: input.taps,
    interTapMs: input.interTapMs,
    settings: settings.security,
  });

  const momentum = assessment.reasons.includes("TAP_CADENCE_TOO_REGULAR")
    ? applyMacroPenalty(momentumInput, settings.momentum)
    : momentumInput;

  const today = utcDateKey(now);
  const tapKey = `tap:${user.id}:${input.nonce}`;

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");
    if (locked.isBanned) throw new AppError("FORBIDDEN", "Account is restricted");

    const levels = await getUpgradeLevels(tx, user.id);
    const snapshot = computeEnergy(
      settings.economy,
      { energyCapLevel: levels.energy_cap, regenLevel: levels.regen },
      locked.energy,
      locked.energyUpdatedAt,
      now,
    );

    if (await hasEntry(tx, user.id, tapKey)) {
      return {
        taps: 0,
        reward: 0,
        balance: Number(locked.balance),
        energy: snapshot.energy,
        energyCap: snapshot.cap,
        momentum,
        flagged: assessment.flagged,
        flagReasons: assessment.reasons,
        duplicate: true,
        signupBonus: 0,
      };
    }

    const [todayRow] = await tx
      .select({ coinsEarned: dailyActivity.coinsEarned })
      .from(dailyActivity)
      .where(and(eq(dailyActivity.userId, user.id), eq(dailyActivity.dateKey, today)))
      .limit(1);
    const earnedToday = Number(todayRow?.coinsEarned ?? 0);
    const remainingDaily = Math.max(0, settings.economy.max_daily_coins - earnedToday);
    if (remainingDaily <= 0) {
      throw new AppError("DAILY_CAP_REACHED", "Daily coin cap reached", {
        details: { cap: settings.economy.max_daily_coins },
      });
    }

    const coinsPerTap = tapReward(settings.economy, levels.tap_power) * Math.max(0, momentum.total);
    const maxByCap = Math.floor(remainingDaily / Math.max(1e-9, coinsPerTap));
    const taps = Math.max(0, Math.min(assessment.allowedTaps, snapshot.energy, maxByCap));

    if (taps <= 0) {
      if (snapshot.energy <= 0) {
        throw new AppError("INSUFFICIENT_ENERGY", "Energy is empty", {
          details: { nextRegenInSeconds: snapshot.nextRegenInSeconds },
        });
      }
      throw new AppError("DAILY_CAP_REACHED", "Daily coin cap reached");
    }

    const nextEnergy = consumeEnergy(snapshot, taps);
    const reward = Math.floor(coinsPerTap * taps);

    const nonceInsert = await tx
      .insert(usedNonces)
      .values({ userId: user.id, nonce: input.nonce, scope: "tap" })
      .onConflictDoNothing()
      .returning({ nonce: usedNonces.nonce });
    if (nonceInsert.length === 0) {
      throw new AppError("CONFLICT", "Tap nonce was already used");
    }

    const result = await post(tx, {
      userId: user.id,
      delta: reward,
      type: "tap",
      refId: input.nonce,
      idempotencyKey: tapKey,
      momentum: momentum.total,
      meta: { taps, flagged: assessment.flagged, reasons: assessment.reasons },
    });

    let signupBonus = 0;
    if (!(await hasEntry(tx, user.id, `signup:${user.id}`))) {
      const signup = await post(tx, {
        userId: user.id,
        delta: settings.economy.signup_coins,
        type: "signup",
        refId: "first_tap",
        idempotencyKey: `signup:${user.id}`,
        momentum: momentum.total,
        meta: {},
      });
      signupBonus = settings.economy.signup_coins;
      void signup;
    }

    await tx
      .update(users)
      .set({
        energy: nextEnergy.energy,
        energyUpdatedAt: nextEnergy.energyUpdatedAt,
        momentum: momentum.total.toFixed(2),
        momentumUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await recordActivity(tx, user.id, today, {
      taps,
      coinsEarned: reward,
      momentumSnapshot: momentum.total,
    });

    if (assessment.flagged) {
      await tx.insert(anomalies).values({
        userId: user.id,
        kind: "TAP_PATTERN",
        score: String(assessment.reasons.length),
        payload: { reasons: assessment.reasons, taps: input.taps },
      });
    }

    return {
      taps,
      reward,
      balance: result.balance + signupBonus,
      energy: nextEnergy.energy,
      energyCap: nextEnergy.cap,
      momentum,
      flagged: assessment.flagged,
      flagReasons: assessment.reasons,
      duplicate: false,
      signupBonus,
    };
  });
}

export interface HeartbeatResult {
  creditedSeconds: number;
  secondsActiveToday: number;
  maxSeconds: number;
}

/** Signed heartbeat for the duration bonus (PLAN §10.3). */
export async function recordHeartbeat(
  db: Database,
  user: UserRow,
  settings: Settings,
  nonce: string,
  now: Date,
): Promise<HeartbeatResult> {
  const windowStart = new Date(now.getTime() - settings.security.heartbeat_window_seconds * 1000);
  const today = utcDateKey(now);

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!locked) throw new AppError("NOT_FOUND", "User not found");

    const [interaction] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          eq(transactions.type, "tap"),
          gte(transactions.createdAt, windowStart),
        ),
      )
      .limit(1);
    if (!interaction) {
      throw new AppError("CONFLICT", "Heartbeat requires a recent tap");
    }

    const inserted = await tx
      .insert(usedNonces)
      .values({ userId: user.id, nonce, scope: "heartbeat" })
      .onConflictDoNothing()
      .returning({ nonce: usedNonces.nonce });
    if (inserted.length === 0) {
      throw new AppError("CONFLICT", "Heartbeat nonce was already used");
    }

    const [activityRow] = await tx
      .select({ secondsActive: dailyActivity.secondsActive })
      .from(dailyActivity)
      .where(and(eq(dailyActivity.userId, user.id), eq(dailyActivity.dateKey, today)))
      .limit(1);

    const maxSeconds = settings.security.max_daily_minutes * 60;
    const existing = activityRow?.secondsActive ?? 0;
    const credited = Math.max(0, Math.min(60, maxSeconds - existing));

    if (credited > 0) {
      await recordActivity(tx, user.id, today, { secondsActive: credited });
    }

    return {
      creditedSeconds: credited,
      secondsActiveToday: existing + credited,
      maxSeconds,
    };
  });
}
