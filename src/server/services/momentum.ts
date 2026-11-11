import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { referrals } from "@/db/schema";
import type { MomentumComponents } from "@/lib/types";
import { addDaysKey, utcDateKey } from "@/lib/dates";
import type { Settings } from "@/server/config/settings";
import { countCheckedInDays, getActivityForDate, getRecentActivity } from "@/server/economy/activity";
import { computeMomentum } from "@/server/economy/momentum";
import type { UserRow } from "@/server/services/users";

export interface UserMomentum {
  momentum: MomentumComponents;
  todayActivity: Awaited<ReturnType<typeof getActivityForDate>>;
  weeklyCheckins: number;
  qualifiedReferrals: number;
}

export async function computeUserMomentum(
  exec: DbExecutor,
  user: UserRow,
  settings: Settings,
  now: Date,
): Promise<UserMomentum> {
  const today = utcDateKey(now);
  const weekStart = addDaysKey(today, -6);

  const [todayActivity, recentActivity, weeklyCheckins, qualifiedRow] = await Promise.all([
    getActivityForDate(exec, user.id, today),
    getRecentActivity(exec, user.id, weekStart, today),
    countCheckedInDays(exec, user.id, weekStart),
    exec
      .select({ value: sql<string>`count(*)` })
      .from(referrals)
      .where(and(eq(referrals.referrerId, user.id), eq(referrals.qualified, true))),
  ]);

  const qualifiedReferrals = Number(qualifiedRow[0]?.value ?? 0);
  const dailyQuestSetComplete = (todayActivity?.questsDone ?? 0) >= settings.economy.daily_quests.length;

  const momentum = computeMomentum({
    settings: settings.momentum,
    activity: recentActivity,
    today,
    streakDays: user.streakDays,
    dailyQuestSetComplete,
    weeklyQuestComplete: weeklyCheckins >= 7,
    activeReferrals: qualifiedReferrals,
  });

  return { momentum, todayActivity, weeklyCheckins, qualifiedReferrals };
}
