import { adStartRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { startAd } from "@/server/services/ads";

/** PLAN �?6, �?2.7, �?8: issue a single-use ad nonce (free quota or ticket). */
export const POST = createUserRoute(
  { route: "tasks.ad.start", limit: 10, windowSeconds: 60, schema: adStartRequestSchema },
  async ({ db, user, settings, now }) => {
    const result = await startAd(db, user, settings, now);
    return json(result);
  },
);
