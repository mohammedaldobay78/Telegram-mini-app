import { AppError } from "@/lib/errors";
import { heartbeatRequestSchema } from "@/lib/schemas";
import { createUserRoute, json } from "@/server/http/route";
import { recordHeartbeat } from "@/server/services/tap";

/** PLAN �?10.3: signed heartbeat; hidden tabs do not earn duration credit. */
export const POST = createUserRoute(
  { route: "heartbeat", limit: 30, windowSeconds: 60, schema: heartbeatRequestSchema },
  async ({ db, user, settings, body, now }) => {
    if (!body.visible) {
      throw new AppError("CONFLICT", "Hidden tab heartbeats are ignored");
    }
    const result = await recordHeartbeat(db, user, settings, body.nonce, now);
    return json(result);
  },
);
