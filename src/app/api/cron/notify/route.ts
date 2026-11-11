import { getDb } from "@/db/client";
import { createCronRoute, json } from "@/server/http/route";
import { getSettings } from "@/server/config/settings";
import { processPushQueue } from "@/server/telegram/notify";

/** PLAN �?3.2, �?4.5: worker-finished and streak-ending pushes, max 2/day. */
export const GET = createCronRoute("cron.notify", async () => {
  const settings = await getSettings();
  const result = await processPushQueue(getDb(), settings, new Date());
  return json({ ok: true, ...result, serverTime: new Date().toISOString() });
});
