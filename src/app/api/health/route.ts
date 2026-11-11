import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, pingDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { errorResponse, json } from "@/server/http/route";

/** PLAN �?6, M0: db + cache + bot configuration health check. */
export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const env = getEnv();
  const started = Date.now();
  try {
    const dbMs = await pingDb(getDb());
    return json({
      status: "ok",
      checks: {
        db: { ok: true, latencyMs: dbMs },
        redis: { configured: Boolean(env.REDIS_URL && env.REDIS_TOKEN) },
        bot: { configured: Boolean(env.BOT_TOKEN) },
        webhookSecret: { configured: Boolean(env.WEBHOOK_SECRET) },
        adsProvider: env.AD_PROVIDER,
      },
      uptimeMs: Math.round(process.uptime() * 1000),
      tookMs: Date.now() - started,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error, requestId, "health");
  }
}
