import { tapRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { utcDateKey } from "@/lib/dates";
import { computeUserMomentum } from "@/server/services/momentum";
import { payReferralCommission } from "@/server/services/referrals";
import { performTapBatch } from "@/server/services/tap";

/**
 * PLAN �?6, �?2.2, �?10.2: the client sends a batch size and a nonce only.
 * Energy, momentum and reward are computed server-side.
 */
export const POST = createUserRoute(
  { route: "tap", limit: 60, windowSeconds: 1, ipLimit: 120, schema: tapRequestSchema },
  async ({ db, user, settings, body, now }) => {
    const { momentum } = await computeUserMomentum(db, user, settings, now);
    const result = await performTapBatch(db, user, settings, body, momentum, now);

    if (result.reward > 0) {
      await payReferralCommission(db, user.id, result.reward, `tap:${user.id}:${body.nonce}`, settings, now).catch(
        () => undefined,
      );
    }

    return json({
      ...result,
      dateKey: utcDateKey(now),
      serverTime: now.toISOString(),
    });
  },
);
