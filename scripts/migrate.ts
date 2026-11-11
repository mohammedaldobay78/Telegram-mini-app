import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Forward-only migration runner (PLAN �?11.3). Drizzle generates the SQL into
 * `src/db/migrations`; this script applies everything pending and exits.
 *
 * Usage: `pnpm db:migrate` with DATABASE_URL set.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
    return;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, "../src/db/migrations");

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder });
    console.log(JSON.stringify({ level: "info", message: "migrations_applied", migrationsFolder }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "migrations_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
