import { desc, eq, sql } from "drizzle-orm";
import { referrals, users } from "@/db/schema";
import { referralsQuerySchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { getEnv } from "@/lib/env";

/** PLAN �?6, �?2.8: invite link, invitee list and qualification state. */
export const GET = createUserRoute({ route: "referrals", limit: 30, windowSeconds: 60 }, async ({ db, user, req }) => {
  const query = referralsQuerySchema.parse({
    limit: req.nextUrl.searchParams.get("limit") ?? undefined,
  });

  const rows = await db
    .select({
      inviteeId: referrals.inviteeId,
      qualified: referrals.qualified,
      createdAt: referrals.createdAt,
      firstName: users.firstName,
      username: users.username,
      lifetimeCoinsEarned: users.lifetimeCoinsEarned,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.inviteeId))
    .where(eq(referrals.referrerId, user.id))
    .orderBy(desc(referrals.createdAt))
    .limit(query.limit);

  const [totals] = await db
    .select({
      total: sql<string>`count(*)`,
      qualified: sql<string>`count(*) filter (where ${referrals.qualified})`,
    })
    .from(referrals)
    .where(eq(referrals.referrerId, user.id));

  const botUsername = getEnv().BOT_USERNAME ?? "your_bot";
  return json({
    code: user.referralCode,
    inviteLink: `https://t.me/${botUsername}?startapp=ref_${user.referralCode}`,
    totals: {
      total: Number(totals?.total ?? 0),
      qualified: Number(totals?.qualified ?? 0),
    },
    invitees: rows.map((row) => ({
      id: row.inviteeId,
      name: row.firstName ?? "Player",
      username: row.username,
      qualified: row.qualified,
      joinedAt: row.createdAt.toISOString(),
      lifetimeCoinsEarned: Number(row.lifetimeCoinsEarned),
    })),
  });
});
