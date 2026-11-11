import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type Database = PostgresJsDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbExecutor = Database | DbTransaction;

interface DbGlobal {
  __earnMoneySql?: ReturnType<typeof postgres>;
  __earnMoneyDb?: Database;
}

const globalForDb = globalThis as unknown as DbGlobal;

export function getDb(): Database {
  if (globalForDb.__earnMoneyDb) return globalForDb.__earnMoneyDb;

  const url = getEnv().DATABASE_URL;
  if (!url) {
    throw new AppError("CONFIG_ERROR", "DATABASE_URL is not configured");
  }

  const sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
  });
  const db = drizzle(sql, { schema });
  globalForDb.__earnMoneySql = sql;
  globalForDb.__earnMoneyDb = db;
  return db;
}

export async function pingDb(db: Database = getDb()): Promise<number> {
  const started = Date.now();
  await db.execute("select 1");
  return Date.now() - started;
}

export async function closeDb(): Promise<void> {
  const sql = globalForDb.__earnMoneySql;
  if (sql) {
    await sql.end({ timeout: 5 });
    globalForDb.__earnMoneySql = undefined;
    globalForDb.__earnMoneyDb = undefined;
  }
}

export { schema };
