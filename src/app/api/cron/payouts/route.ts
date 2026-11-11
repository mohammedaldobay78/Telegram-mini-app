import { getDb } from "@/db/client";
import { createCronRoute, json } from "@/server/http/route";
import { getSettings } from "@/server/config/settings";
import { processPayoutQueue } from "@/server/services/redemption";

/** PLAN �?4.5, �?9.3–�?9.4: deliver approved redemptions, refund failures. */
export const GET = createCronRoute("cron.payouts", async () => {
  const settings = await getSettings();
  const result = await processPayoutQueue(getDb(), settings, new Date());
  return json({ ok: true, ...result, serverTime: new Date().toISOString() });
});
