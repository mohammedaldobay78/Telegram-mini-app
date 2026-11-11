import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/db/client";
import { users } from "@/db/schema";
import { DEFAULT_SETTINGS, SETTINGS_SECTIONS } from "@/server/config/settings";
import { settings as settingsTable } from "@/db/schema";

/**
 * Idempotent seed: settings defaults + a demo user for local development.
 * Run with `pnpm db:seed` after migrations (PLAN §11.3).
 */
export async function seed(db: Database = getDb()): Promise<{ settings: number; demoUserId: number | null }> {
  let seeded = 0;
  for (const section of SETTINGS_SECTIONS) {
    await db
      .insert(settingsTable)
      .values({ key: section, value: DEFAULT_SETTINGS[section] as never })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: DEFAULT_SETTINGS[section] as never, updatedAt: new Date() },
      });
    seeded += 1;
  }

  const demoTelegramId = 999_000_001;
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.telegramId, demoTelegramId)).limit(1);
  let demoUserId: number | null = existing[0]?.id ?? null;

  if (!demoUserId) {
    const [created] = await db
      .insert(users)
      .values({
        telegramId: demoTelegramId,
        firstName: "Demo",
        username: "demo_player",
        referralCode: randomBytes(6).toString("hex"),
        isAdmin: process.env.NODE_ENV !== "production",
      })
      .returning({ id: users.id });
    demoUserId = created?.id ?? null;
  }

  return { settings: seeded, demoUserId };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  seed()
    .then((result) => {
      console.log(JSON.stringify({ level: "info", message: "seed_complete", ...result }));
      process.exit(0);
    })
    .catch((error) => {
      console.error(JSON.stringify({ level: "error", message: "seed_failed", error: String(error) }));
      process.exit(1);
    });
}
