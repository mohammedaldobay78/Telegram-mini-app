import { desc, eq, inArray, sql } from "drizzle-orm";
import { anomalies, redemptions, users } from "@/db/schema";
import { createUserRoute, json } from "@/server/http/route";
import { adminDecideRedemption } from "@/server/services/redemption";
import { adminRedemptionRequestSchema } from "@/lib/schemas";
import { adminCallbackData, verifyAdminCallback, verifyAdminParts } from "@/server/telegram/sign";

/** PLAN �?6, �?9.3: admin queue overview. */
export const GET = createUserRoute(
  { route: "admin.overview", limit: 60, windowSeconds: 60, requireAdmin: true },
  async ({ db, settings, now }) => {
    const pending = await db
      .select({
        id: redemptions.id,
        userId: redemptions.userId,
        coins: redemptions.coins,
        stars: redemptions.stars,
        giftId: redemptions.giftId,
        status: redemptions.status,
        createdAt: redemptions.createdAt,
        firstName: users.firstName,
        username: users.username,
        telegramId: users.telegramId,
        estRevenueMicro: users.estRevenueMicro,
        riskFlags: users.riskFlags,
      })
      .from(redemptions)
      .innerJoin(users, eq(users.id, redemptions.userId))
      .where(inArray(redemptions.status, ["requested", "approved", "sent", "failed"]))
      .orderBy(desc(redemptions.createdAt))
      .limit(50);

    const [recentAnomalies] = await Promise.all([
      db
        .select()
        .from(anomalies)
        .where(eq(anomalies.resolved, false))
        .orderBy(desc(anomalies.createdAt))
        .limit(20),
    ]);

    const [counts] = await db
      .select({
        requested: sql<string>`count(*) filter (where ${redemptions.status} = 'requested')`,
        approved: sql<string>`count(*) filter (where ${redemptions.status} = 'approved')`,
        delivered: sql<string>`count(*) filter (where ${redemptions.status} = 'delivered')`,
        failed: sql<string>`count(*) filter (where ${redemptions.status} = 'failed')`,
      })
      .from(redemptions);

    return json({
      queue: pending.map((row) => ({
        ...row,
        coins: Number(row.coins),
        estRevenueMicro: Number(row.estRevenueMicro),
        createdAt: row.createdAt.toISOString(),
        // Pre-signed by the server so the admin UI can act without holding
        // WEBHOOK_SECRET. Signatures expire; see settings.security.
        actions:
          row.status === "requested"
            ? {
                approve: adminCallbackData(row.id, "approve", now),
                reject: adminCallbackData(row.id, "reject", now),
              }
            : null,
      })),
      counts: {
        requested: Number(counts?.requested ?? 0),
        approved: Number(counts?.approved ?? 0),
        delivered: Number(counts?.delivered ?? 0),
        failed: Number(counts?.failed ?? 0),
      },
      anomalies: recentAnomalies,
      flags: settings.flags,
      caps: {
        weekly: settings.payouts.weekly_cap_stars,
        monthly: settings.payouts.monthly_cap_stars,
        globalBudgetRatio: settings.payouts.global_budget_ratio,
      },
      serverTime: now.toISOString(),
    });
  },
);

/** PLAN �?6, �?9.3: approve/reject with signed callback data and audit. */
export const POST = createUserRoute(
  { route: "admin.redemption", limit: 30, windowSeconds: 60, requireAdmin: true, schema: adminRedemptionRequestSchema },
  async ({ db, user, settings, body, now }) => {
    let redemptionId: number;
    let action: "approve" | "reject";

    if ("callbackData" in body) {
      const verified = verifyAdminCallback(body.callbackData, settings.security.admin_callback_max_age_seconds, now);
      redemptionId = verified.redemptionId;
      action = verified.action;
    } else {
      const verified = verifyAdminParts(
        Number(body.redemptionId),
        body.action,
        body.at,
        body.signature,
        settings.security.admin_callback_max_age_seconds,
        now,
      );
      redemptionId = verified.redemptionId;
      action = verified.action;
    }

    const result = await adminDecideRedemption(db, redemptionId, action, user.telegramId, settings, now);
    return json(result);
  },
);
