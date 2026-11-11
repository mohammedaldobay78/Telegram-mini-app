import { AppError } from "@/lib/errors";
import { redeemRequestSchema } from "@/lib/schemas";
import { isGiftTier } from "@/server/economy/pricing";
import { createUserRoute, json } from "@/server/http/route";
import { requestRedemption } from "@/server/services/redemption";

/** PLAN �?6, �?9.2: request a gift; coins are locked immediately. */
export const POST = createUserRoute(
  { route: "redeem", limit: 2, windowSeconds: 60, schema: redeemRequestSchema },
  async ({ db, user, settings, body, now }) => {
    if (!isGiftTier(body.giftId)) throw new AppError("NOT_FOUND", "Unknown gift tier");
    const result = await requestRedemption(db, user, settings, body.giftId, body.idempotencyKey, now);
    return json(result);
  },
);
