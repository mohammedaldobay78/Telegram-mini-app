import { idempotentRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { claimDailyGift } from "@/server/services/rewards";

/** Daily gift + weekly chain (PLAN �?2.2, �?3.3). Keyed by UTC date. */
export const POST = createUserRoute(
  { route: "tasks.checkin", limit: 5, windowSeconds: 60, schema: idempotentRequestSchema },
  async ({ db, user, settings, now }) => {
    const result = await claimDailyGift(db, user, settings, now);
    return json(result);
  },
);
