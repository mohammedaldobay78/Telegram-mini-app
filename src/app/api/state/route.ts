import { createUserRoute, json } from "@/server/http/route";
import { buildState } from "@/server/services/state";

/** PLAN �?6: GET /api/state — balance, energy, M, quests, timers. */
export const GET = createUserRoute({ route: "state", limit: 60, windowSeconds: 60 }, async ({ db, user, settings, now }) => {
  const state = await buildState({ db, user, settings, now });
  return json(state);
});
