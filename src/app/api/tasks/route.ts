import { createUserRoute, json } from "@/server/http/route";
import { countActiveDays } from "@/server/economy/activity";
import { recentTransactions } from "@/server/services/rewards";
import { buildState } from "@/server/services/state";
import { toPublicUser } from "@/server/services/users";
import { coinPacks } from "@/server/services/stars";

/** PLAN �?6: GET /api/tasks — quests, ad availability and wallet-side extras. */
export const GET = createUserRoute({ route: "tasks", limit: 60, windowSeconds: 60 }, async ({ db, user, settings, now }) => {
  const [state, transactions, activeDays] = await Promise.all([
    buildState({ db, user, settings, now }),
    recentTransactions(db, user.id, 30),
    countActiveDays(db, user.id),
  ]);

  return json({
    state,
    transactions,
    coinPacks: coinPacks(settings),
    account: {
      ...toPublicUser(user),
      activeDays,
      lifetimeAdViews: user.lifetimeAdViews,
      estRevenueMicro: Number(user.estRevenueMicro),
      riskFlags: user.riskFlags,
    },
    serverTime: now.toISOString(),
  });
});
