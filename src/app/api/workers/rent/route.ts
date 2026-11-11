import { workerRentRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { rentWorkerService } from "@/server/services/store";

/** PLAN �?6, �?2.6: rent a worker tier for 1/8/24 hours. */
export const POST = createUserRoute(
  { route: "workers.rent", limit: 5, windowSeconds: 60, schema: workerRentRequestSchema },
  async ({ db, user, settings, body, now }) => {
    const result = await rentWorkerService(db, user, settings, body.tier, body.hours, body.idempotencyKey, now);
    return json(result);
  },
);
