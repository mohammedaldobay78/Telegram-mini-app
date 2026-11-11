import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database, DbExecutor } from "@/db/client";
import { upgrades, users } from "@/db/schema";
import type { UserPublic } from "@/lib/types";
import type { TelegramUser } from "@/server/auth/init-data";
import { AppError } from "@/lib/errors";
import type { UpgradeLevels } from "@/server/economy/store";
import { EMPTY_UPGRADES } from "@/server/economy/store";

export type UserRow = typeof users.$inferSelect;

export async function findUserById(exec: DbExecutor, id: number): Promise<UserRow | null> {
  const [row] = await exec.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function findUserByTelegramId(exec: DbExecutor, telegramId: number): Promise<UserRow | null> {
  const [row] = await exec.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return row ?? null;
}

export async function requireUser(exec: DbExecutor, id: number): Promise<UserRow> {
  const row = await findUserById(exec, id);
  if (!row) throw new AppError("NOT_FOUND", "User not found");
  if (row.isBanned) throw new AppError("FORBIDDEN", "Account is restricted");
  return row;
}

export function newReferralCode(): string {
  return randomBytes(6).toString("base64url").slice(0, 10);
}

export interface UpsertUserOptions {
  isAdmin: boolean;
}

export async function upsertTelegramUser(
  db: Database,
  telegramUser: TelegramUser,
  options: UpsertUserOptions,
): Promise<{ user: UserRow; isNewUser: boolean }> {
  const existing = await findUserByTelegramId(db, telegramUser.id);

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        username: telegramUser.username ?? null,
        firstName: telegramUser.first_name,
        photoUrl: telegramUser.photo_url ?? null,
        languageCode: telegramUser.language_code ?? null,
        isAdmin: existing.isAdmin || options.isAdmin,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();
    if (!updated) throw new AppError("INTERNAL_ERROR", "Failed to update user");
    return { user: updated, isNewUser: false };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [created] = await db
        .insert(users)
        .values({
          telegramId: telegramUser.id,
          username: telegramUser.username ?? null,
          firstName: telegramUser.first_name,
          photoUrl: telegramUser.photo_url ?? null,
          languageCode: telegramUser.language_code ?? null,
          referralCode: newReferralCode(),
          isAdmin: options.isAdmin,
        })
        .returning();
      if (!created) throw new AppError("INTERNAL_ERROR", "Failed to create user");
      return { user: created, isNewUser: true };
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  throw new AppError("INTERNAL_ERROR", "Failed to create user");
}

export async function getUpgradeLevels(exec: DbExecutor, userId: number): Promise<UpgradeLevels> {
  const rows = await exec.select().from(upgrades).where(eq(upgrades.userId, userId));
  const levels: UpgradeLevels = { ...EMPTY_UPGRADES };
  for (const row of rows) {
    if (row.kind === "tap_power" || row.kind === "energy_cap" || row.kind === "regen") {
      levels[row.kind] = row.level;
    }
  }
  return levels;
}

export function toPublicUser(row: UserRow): UserPublic {
  return {
    id: row.id,
    telegramId: row.telegramId,
    username: row.username,
    firstName: row.firstName,
    photoUrl: row.photoUrl,
    isAdmin: row.isAdmin,
    balance: Number(row.balance),
    lifetimeCoinsEarned: Number(row.lifetimeCoinsEarned),
    createdAt: row.createdAt.toISOString(),
  };
}

export function accountAgeDays(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000));
}
