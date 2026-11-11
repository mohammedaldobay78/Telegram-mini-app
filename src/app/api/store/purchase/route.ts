import { purchaseRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { purchaseStoreItem } from "@/server/services/store";

/** PLAN �?6, �?2.5: upgrade or consumable purchase with idempotency. */
export const POST = createUserRoute(
  { route: "store.purchase", limit: 10, windowSeconds: 60, schema: purchaseRequestSchema },
  async ({ db, user, settings, body, now }) => {
    const result = await purchaseStoreItem(db, user, settings, body.kind, body.idempotencyKey, now);
    return json(result);
  },
);
