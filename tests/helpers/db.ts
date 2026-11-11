import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { users } from "@/db/schema";
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from "@/server/config/settings";

/**
 * In-memory Postgres for integration tests. Applies the same forward-only
 * migrations as production, so the schema under test is the real one.
 */
export interface TestDb {
  client: PGlite;
  db: Database;
  close: () => Promise<void>;
}

export async function makeTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: resolve(process.cwd(), "src/db/migrations") });
  return {
    client,
    db: pglite as unknown as Database,
    close: async () => {
      await client.close();
    },
  };
}

let telegramCounter = 700_000_000;

export interface NewUserInput {
  telegramId?: number;
  firstName?: string;
  username?: string;
  balance?: number;
  energy?: number;
  createdAt?: Date;
  isAdmin?: boolean;
  referralCode?: string;
}

export async function createUser(db: Database, input: NewUserInput = {}) {
  telegramCounter += 1;
  const [row] = await db
    .insert(users)
    .values({
      telegramId: input.telegramId ?? telegramCounter,
      firstName: input.firstName ?? "Tester",
      username: input.username ?? null,
      balance: input.balance ?? 0,
      energy: input.energy ?? 50,
      isAdmin: input.isAdmin ?? false,
      referralCode: input.referralCode ?? `ref_${telegramCounter}`,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error("failed to create test user");
  return row;
}

/**
 * Settings with payout gift ids configured, so redemption tests never call
 * the Telegram API.
 */
export function testSettings(overrides: {
  economy?: Partial<Settings["economy"]>;
  momentum?: Partial<Settings["momentum"]>;
  payouts?: Partial<Settings["payouts"]>;
  flags?: Partial<Settings["flags"]>;
} = {}): Settings {
  return mergeSettings({
    economy: { ...DEFAULT_SETTINGS.economy, ...overrides.economy },
    momentum: { ...DEFAULT_SETTINGS.momentum, ...overrides.momentum },
    payouts: {
      ...DEFAULT_SETTINGS.payouts,
      gift_ids: { starter: "gift-starter", standard: "gift-standard", premium: "gift-premium" },
      ...overrides.payouts,
    },
    flags: { ...DEFAULT_SETTINGS.flags, ...overrides.flags },
  });
}
