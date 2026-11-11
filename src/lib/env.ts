import { z } from "zod";

/**
 * Runtime environment configuration (PLAN §4.3, §14).
 *
 * Parsing is lazy so that `next build` and unit tests can run without a
 * production `.env`. Routes that genuinely need a secret call `requireEnv`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_ENV: z.enum(["local", "preview", "production"]).default("local"),

  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  REDIS_TOKEN: z.string().min(1).optional(),

  BOT_TOKEN: z.string().optional(),
  BOT_USERNAME: z.string().optional(),
  WEBHOOK_SECRET: z.string().min(1).optional(),
  TELEGRAM_WEBAPP_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
  ADMIN_IDS: z.string().default(""),

  AD_PROVIDER: z.enum(["mock", "adsgram"]).default("mock"),
  ADSGRAM_BLOCK_ID: z.string().optional(),
  ADSGRAM_SECRET: z.string().optional(),

  CRON_SECRET: z.string().min(1).optional(),
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}

export function adminIds(): number[] {
  return getEnv()
    .ADMIN_IDS.split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

export function isTest(): boolean {
  return getEnv().NODE_ENV === "test";
}

/** Test-only helper. Never call from application code. */
export function resetEnvCache(): void {
  cached = null;
}
