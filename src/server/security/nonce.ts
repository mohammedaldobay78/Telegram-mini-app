import { randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { Redis } from "@upstash/redis";

const memory = new Map<string, number>();
let redisClient: Redis | null | undefined;

function redis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const env = getEnv();
  if (!env.REDIS_URL || !env.REDIS_TOKEN) {
    redisClient = null;
    return null;
  }
  redisClient = new Redis({ url: env.REDIS_URL, token: env.REDIS_TOKEN });
  return redisClient;
}

/** Single-use nonce (PLAN §10.3). DB unique constraints remain the backstop. */
export async function consumeNonce(scope: string, userId: number, nonce: string, ttlSeconds = 600): Promise<boolean> {
  const key = `nonce:${scope}:${userId}:${nonce}`;
  const client = redis();
  if (client) {
    try {
      const result = await client.set(key, "1", { nx: true, ex: ttlSeconds });
      return result === "OK";
    } catch {
      // local fallback below
    }
  }
  const now = Date.now();
  const existing = memory.get(key);
  if (existing && existing > now) return false;
  memory.set(key, now + ttlSeconds * 1000);
  if (memory.size > 20_000) {
    for (const [entryKey, expiresAt] of memory) {
      if (expiresAt <= now) memory.delete(entryKey);
    }
  }
  return true;
}

export function createNonce(prefix = "n"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function resetNonces(): void {
  memory.clear();
}
