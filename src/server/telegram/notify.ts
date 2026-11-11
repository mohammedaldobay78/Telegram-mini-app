import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { notifications, users, workers } from "@/db/schema";
import { adminIds, getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { utcDateKey, yesterdayKey } from "@/lib/dates";
import type { Settings } from "@/server/config/settings";
import { sendMessage } from "./api";

const MAX_PUSHES_PER_DAY = 2;

export async function notifyUser(telegramId: number, text: string, replyMarkup?: unknown): Promise<boolean> {
  try {
    await sendMessage({ chatId: telegramId, text, replyMarkup });
    return true;
  } catch (error) {
    logger.warn("notify_user_failed", { telegram_id: telegramId, error: String(error) });
    return false;
  }
}

export async function notifyAdmins(text: string, replyMarkup?: unknown): Promise<number> {
  const ids = adminIds();
  if (ids.length === 0) {
    logger.warn("notify_admins_no_recipients", { text });
    return 0;
  }
  let sent = 0;
  for (const id of ids) {
    if (await notifyUser(id, text, replyMarkup)) sent += 1;
  }
  return sent;
}

/**
 * Enforces PLAN §3.2: never more than 2 bot messages per user per day. The
 * unique (user, kind, day) index makes retries and concurrent crons safe.
 */
export async function pushOnce(
  db: Database,
  user: { id: number; telegramId: number },
  kind: string,
  text: string,
  now: Date,
): Promise<boolean> {
  const dayKey = utcDateKey(now);

  const [countRow] = await db
    .select({ value: sql<string>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.dayKey, dayKey)));
  if (Number(countRow?.value ?? 0) >= MAX_PUSHES_PER_DAY) return false;

  const inserted = await db
    .insert(notifications)
    .values({ userId: user.id, kind, dayKey })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (inserted.length === 0) return false;

  return notifyUser(user.telegramId, text);
}

/** PLAN §3.2 / §4.5: two push types, each at most once per user per day. */
export async function processPushQueue(db: Database, _settings: Settings, now: Date): Promise<{ sent: number; skipped: number }> {
  const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000);
  let sent = 0;
  let skipped = 0;

  const finished = await db
    .select({
      userId: users.id,
      telegramId: users.telegramId,
      coins: sql<string>`count(${workers.id})`,
    })
    .from(workers)
    .innerJoin(users, eq(users.id, workers.userId))
    .where(and(gte(workers.rentalEndsAt, twoHoursAgo), sql`${workers.rentalEndsAt} <= ${now}`, eq(users.isBanned, false)))
    .groupBy(users.id, users.telegramId);

  for (const row of finished) {
    const ok = await pushOnce(
      db,
      { id: row.userId, telegramId: row.telegramId },
      "workers_finished",
      "Workers finished — open the app to collect your coins.",
      now,
    );
    if (ok) sent += 1;
    else skipped += 1;
  }

  const yesterday = yesterdayKey(utcDateKey(now));
  const streaks = await db
    .select({ id: users.id, telegramId: users.telegramId, streakDays: users.streakDays })
    .from(users)
    .where(and(eq(users.lastCheckinDate, yesterday), gte(users.streakDays, 2), eq(users.isBanned, false)));

  for (const row of streaks) {
    const ok = await pushOnce(
      db,
      { id: row.id, telegramId: row.telegramId },
      "streak_ending",
      `Your ${row.streakDays}-day streak ends in 6 h. Check in to keep it.`,
      now,
    );
    if (ok) sent += 1;
    else skipped += 1;
  }

  return { sent, skipped };
}

export function appUrl(): string {
  return getEnv().TELEGRAM_WEBAPP_URL ?? "https://example.com";
}
