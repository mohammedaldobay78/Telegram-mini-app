import { questClaimRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { payReferralCommission } from "@/server/services/referrals";
import { claimQuest } from "@/server/services/rewards";

/** Daily quest claim (PLAN �?2.2): progress is server-derived. */
export const POST = createUserRoute(
  { route: "tasks.quest", limit: 10, windowSeconds: 60, schema: questClaimRequestSchema },
  async ({ db, user, settings, body, now }) => {
    const result = await claimQuest(db, user, settings, body.questId, now);
    if (result.reward > 0) {
      await payReferralCommission(
        db,
        user.id,
        result.reward,
        `quest:${user.id}:${body.questId}:${body.idempotencyKey}`,
        settings,
        now,
      ).catch(() => undefined);
    }
    return json(result);
  },
);
