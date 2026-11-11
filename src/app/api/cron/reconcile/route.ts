import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { anomalies, redemptions, transactions, users } from "@/db/schema";
import { createCronRoute, json } from "@/server/http/route";
import { getSettings } from "@/server/config/settings";
import { logger } from "@/lib/logger";
import { notifyAdmins } from "@/server/telegram/notify";

/**
 * PLAN �?2.12.1, �?4.5, �?11.2: ledger vs balance reconciliation. Any drift
 * above the configured threshold is written to `anomalies` and freezes the
 * account's risk flags; admins are alerted, never silently ignored.
 */
export const GET = createCronRoute("cron.reconcile", async () => {
  const db = getDb();
  const settings = await getSettings();
  const now = new Date();

  const rows = await db
    .select({
      id: users.id,
      telegramId: users.telegramId,
      balance: users.balance,
      ledger: sql<string>`coalesce(sum(${transactions.delta}), 0)`,
    })
    .from(users)
    .leftJoin(transactions, eq(transactions.userId, users.id))
    .groupBy(users.id, users.telegramId, users.balance);

  const driftRows: { id: number; telegramId: number; balance: number; ledger: number; drift: number }[] = [];
  for (const row of rows) {
    const balance = Number(row.balance);
    const ledger = Number(row.ledger);
    const drift = balance - ledger;
    if (Math.abs(drift) > settings.security.reconcile_drift_threshold) {
      driftRows.push({ id: row.id, telegramId: row.telegramId, balance, ledger, drift });
    }
  }

  if (driftRows.length > 0) {
    await db.insert(anomalies).values(
      driftRows.map((row) => ({
        userId: row.id,
        kind: "LEDGER_DRIFT",
        score: String(Math.abs(row.drift)),
        payload: { balance: row.balance, ledger: row.ledger, drift: row.drift },
      })),
    );

    for (const row of driftRows) {
      await db
        .update(users)
        .set({
          riskFlags: sql`coalesce(${users.riskFlags}, '{}'::jsonb) || ${JSON.stringify({
            LEDGER_DRIFT: { drift: row.drift, at: now.toISOString() },
          })}::jsonb`,
          updatedAt: now,
        })
        .where(eq(users.id, row.id));
    }

    await notifyAdmins(
      `Reconciliation drift detected on ${driftRows.length} account(s). Payouts are not affected; review the admin queue.`,
    ).catch(() => undefined);
  }

  // A `sent` row older than 15 minutes means the process died between the
  // Telegram call and the delivered/failed update. It is never retried
  // automatically (that could double-send a gift); surface it for manual
  // reconciliation against the bot's gift history.
  const staleCutoff = new Date(now.getTime() - 15 * 60_000);
  const staleSent = await db
    .select({ id: redemptions.id, userId: redemptions.userId, stars: redemptions.stars })
    .from(redemptions)
    .where(and(eq(redemptions.status, "sent"), lt(redemptions.updatedAt, staleCutoff)));

  if (staleSent.length > 0) {
    logger.warn("redemption_sent_stale", {
      count: staleSent.length,
      ids: staleSent.map((row) => row.id),
    });
    await notifyAdmins(
      `Payout reconciliation: ${staleSent.length} redemption(s) stuck in "sent" for >15 min (${staleSent
        .map((row) => `#${row.id}`)
        .join(", ")}). Check the bot's gift history before refunding or resending.`,
    ).catch(() => undefined);
  }

  return json({
    ok: driftRows.length === 0 && staleSent.length === 0,
    checked: rows.length,
    drifted: driftRows.length,
    staleSent: staleSent.length,
    threshold: settings.security.reconcile_drift_threshold,
    sample: driftRows.slice(0, 20),
    serverTime: now.toISOString(),
  });
});
