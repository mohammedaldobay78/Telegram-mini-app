import { Redis } from "@upstash/redis";
import { getEnv } from "@/lib/env";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const memory = new Map<string, WindowEntry>();
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

/**
 * Fixed-window token bucket (PLAN §10.3). Redis is used in production; an
 * in-process window keeps local dev and tests working. Limits are always
 * passed by the route, never by the client.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const now = Date.now();
  const namespaced = `rl:${key}`;
  const client = redis();

  if (client) {
    try {
      const count = await client.incr(namespaced);
      if (count === 1) await client.expire(namespaced, windowSeconds);
      const ttl = await client.ttl(namespaced);
      const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: count <= limit ? 0 : retryAfterSeconds,
      };
    } catch {
      // Fall through to the local limiter: never fail open without a limit.
    }
  }

  const entry = memory.get(namespaced);
  if (!entry || entry.resetAt <= now) {
    memory.set(namespaced, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, limit, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  return {
    allowed: entry.count <= limit,
    limit,
    remaining,
    retryAfterSeconds: entry.count <= limit ? 0 : Math.ceil((entry.resetAt - now) / 1000),
  };
}

export function resetRateLimits(): void {
  memory.clear();
}
