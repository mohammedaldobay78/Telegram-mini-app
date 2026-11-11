import { shopCoinsRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { coinPacks, createPackInvoice } from "@/server/services/stars";

/** PLAN �?6, �?2.10, �?7.5: create a Stars invoice link for a coin pack. */
export const POST = createUserRoute(
  { route: "shop.coins", limit: 5, windowSeconds: 60, schema: shopCoinsRequestSchema },
  async ({ db, user, settings, body }) => {
    const invoice = await createPackInvoice(db, user, settings, body.packId);
    return json({ ...invoice, packs: coinPacks(settings) });
  },
);
