import type { NextRequest } from "next/server";
import { lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { adTickets, telegramUpdates, usedNonces, workers } from "@/db/schema";
import { createCronRoute, json } from "@/server/http/route";
import { clearSettingsCache } from "@/server/config/settings";
import { expireWorkers } from "@/server/services/workers";

/**
 * PLAN �?4.5: daily housekeeping. Counters are keyed by UTC date, so there is
 * no destructive reset; this only removes expired rows and refreshes settings.
 */
export const GET = createCronRoute("cron.reset", async ({ req }) => {
  const db = getDb();
  const now = new Date();
  void (req as NextRequest);

  const expiredWorkers = await expireWorkers(db, now);
  const [oldUpdates, oldNonces, oldTickets] = await Promise.all([
    db
      .delete(telegramUpdates)
      .where(lt(telegramUpdates.processedAt, new Date(now.getTime() - 30 * 86_400_000)))
      .returning({ id: telegramUpdates.updateId }),
    db
      .delete(usedNonces)
      .where(lt(usedNonces.createdAt, new Date(now.getTime() - 7 * 86_400_000)))
      .returning({ nonce: usedNonces.nonce }),
    db
      .delete(adTickets)
      .where(lt(adTickets.expiresAt, new Date(now.getTime() - 86_400_000)))
      .returning({ id: adTickets.id }),
  ]);

  clearSettingsCache();
  return json({
    ok: true,
    expiredWorkers,
    deletedUpdates: oldUpdates.length,
    deletedNonces: oldNonces.length,
    deletedTickets: oldTickets.length,
    serverTime: now.toISOString(),
  });
});
