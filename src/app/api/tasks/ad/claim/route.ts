import { adClaimRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { computeUserMomentum } from "@/server/services/momentum";
import { payReferralCommission } from "@/server/services/referrals";
import { claimAd } from "@/server/services/ads";

/**
 * PLAN �?6, �?8: redeem the nonce after the watch. With the Adsgram provider
 * the client claim is not authoritative — the reward waits for the signed
 * server postback.
 */
export const POST = createUserRoute(
  { route: "tasks.ad.claim", limit: 10, windowSeconds: 60, schema: adClaimRequestSchema },
  async ({ db, user, settings, body, now }) => {
    const { momentum } = await computeUserMomentum(db, user, settings, now);
    const result = await claimAd(db, user, settings, body.nonce, momentum.total, now);
    if (result.reward > 0) {
      await payReferralCommission(
        db,
        user.id,
        result.reward,
        `ad:${user.id}:${body.nonce}`,
        settings,
        now,
      ).catch(() => undefined);
    }
    return json(result);
  },
);
