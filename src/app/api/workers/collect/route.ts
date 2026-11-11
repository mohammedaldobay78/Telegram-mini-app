import { idempotentRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { computeUserMomentum } from "@/server/services/momentum";
import { payReferralCommission } from "@/server/services/referrals";
import { collectWorkers } from "@/server/services/workers";

/** PLAN �?6, �?2.6: collect server-accrued offline income (8 h cap). */
export const POST = createUserRoute(
  { route: "workers.collect", limit: 10, windowSeconds: 60, schema: idempotentRequestSchema },
  async ({ db, user, settings, body, now }) => {
    const { momentum } = await computeUserMomentum(db, user, settings, now);
    const result = await collectWorkers(db, user, settings, momentum.total, body.idempotencyKey, now);
    if (result.collected > 0) {
      await payReferralCommission(
        db,
        user.id,
        result.collected,
        `worker_collect:${user.id}:${body.idempotencyKey}`,
        settings,
        now,
      ).catch(() => undefined);
    }
    return json(result);
  },
);
