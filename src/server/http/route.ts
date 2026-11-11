import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "@/db/client";
import { getDb } from "@/db/client";
import { AppError, errorBody } from "@/lib/errors";
import { adminIds, getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { extractInitData, validateInitData } from "@/server/auth/init-data";
import { getSettings, type Settings } from "@/server/config/settings";
import { rateLimit } from "@/server/security/ratelimit";
import { hashIp } from "@/server/security/ip";
import { findUserByTelegramId, type UserRow } from "@/server/services/users";
import type { InitData } from "@/server/auth/init-data";

export interface RequestContext<TBody> {
  req: NextRequest;
  db: Database;
  user: UserRow;
  initData: InitData;
  settings: Settings;
  now: Date;
  requestId: string;
  body: TBody;
}

export interface UserRouteConfig<TBody> {
  route: string;
  limit: number;
  windowSeconds: number;
  schema?: z.ZodType<TBody>;
  ipLimit?: number;
  ipWindowSeconds?: number;
  requireAdmin?: boolean;
}

export function createUserRoute<TBody = undefined>(
  config: UserRouteConfig<TBody>,
  handler: (ctx: RequestContext<TBody>) => Promise<Response>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const requestId = randomUUID();
    const started = Date.now();
    try {
      const env = getEnv();
      const settings = await getSettings();
      const raw = extractInitData(req.headers);
      if (!raw) throw new AppError("UNAUTHORIZED", "Missing X-Telegram-Init-Data header");
      if (!env.BOT_TOKEN) throw new AppError("CONFIG_ERROR", "BOT_TOKEN is not configured");

      const initData = validateInitData(raw, {
        botToken: env.BOT_TOKEN,
        maxAgeSeconds: settings.security.auth_max_age_seconds,
      });

      const db = getDb();
      const user = await findUserByTelegramId(db, initData.user.id);
      if (!user) throw new AppError("UNAUTHORIZED", "Call /api/auth/telegram first");

      const limit = await rateLimit(`u:${user.id}:${config.route}`, config.limit, config.windowSeconds);
      if (!limit.allowed) {
        throw new AppError("RATE_LIMITED", "Too many requests", {
          retryable: true,
          details: { retryAfterSeconds: limit.retryAfterSeconds },
        });
      }

      if (config.ipLimit) {
        const ipLimit = await rateLimit(
          `ip:${hashIp(req.headers)}:${config.route}`,
          config.ipLimit,
          config.ipWindowSeconds ?? 60,
        );
        if (!ipLimit.allowed) {
          throw new AppError("RATE_LIMITED", "Too many requests from this network", {
            retryable: true,
            details: { retryAfterSeconds: ipLimit.retryAfterSeconds },
          });
        }
      }

      if (config.requireAdmin && !(user.isAdmin || adminIds().includes(user.telegramId))) {
        throw new AppError("FORBIDDEN", "Admin access only");
      }

      let body = undefined as TBody;
      if (config.schema) {
        const rawBody = await req.json().catch(() => null);
        body = config.schema.parse(rawBody);
      }

      const response = await handler({
        req,
        db,
        user,
        initData,
        settings,
        now: new Date(),
        requestId,
        body,
      });

      response.headers.set("x-request-id", requestId);
      logger.info("request_complete", {
        request_id: requestId,
        route: config.route,
        telegram_id: user.telegramId,
        duration_ms: Date.now() - started,
        status: response.status,
      });
      return response;
    } catch (error) {
      const response = errorResponse(error, requestId, config.route);
      response.headers.set("x-request-id", requestId);
      logger.error("request_failed", {
        request_id: requestId,
        route: config.route,
        duration_ms: Date.now() - started,
        status: response.status,
        error: error instanceof Error ? error.message : String(error),
      });
      return response;
    }
  };
}

export function errorResponse(error: unknown, requestId: string, route?: string): NextResponse {
  if (error instanceof z.ZodError) {
    const appError = new AppError("VALIDATION_ERROR", "Invalid request payload", {
      details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
    });
    return NextResponse.json(errorBody(appError, requestId), { status: appError.status });
  }

  if (error instanceof AppError) {
    const response = NextResponse.json(errorBody(error, requestId), {
      status: error.status,
      headers: error.retryable ? { "retry-after": "5" } : undefined,
    });
    return response;
  }

  logger.error("unhandled_error", {
    request_id: requestId,
    route,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return NextResponse.json(
    errorBody(new AppError("INTERNAL_ERROR", "Something went wrong"), requestId),
    { status: 500 },
  );
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Cron endpoints: Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export function verifyCron(req: NextRequest): void {
  const env = getEnv();
  const expected = env.CRON_SECRET;
  if (!expected) {
    if (env.NODE_ENV === "production") throw new AppError("CONFIG_ERROR", "CRON_SECRET is not configured");
    return;
  }
  const authorization = req.headers.get("authorization");
  const header = req.headers.get("x-cron-secret");
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : header;
  if (provided !== expected) throw new AppError("UNAUTHORIZED", "Invalid cron secret");
}

export function verifyWebhookSecret(req: NextRequest): void {
  const expected = getEnv().WEBHOOK_SECRET;
  if (!expected) throw new AppError("CONFIG_ERROR", "WEBHOOK_SECRET is not configured");
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (provided !== expected) throw new AppError("UNAUTHORIZED", "Invalid webhook secret");
}

export function createCronRoute(
  route: string,
  handler: (ctx: { req: NextRequest; requestId: string }) => Promise<Response>,
): (req: NextRequest) => Promise<Response> {
  return async (req) => {
    const requestId = randomUUID();
    try {
      verifyCron(req);
      const response = await handler({ req, requestId });
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      const response = errorResponse(error, requestId, route);
      response.headers.set("x-request-id", requestId);
      return response;
    }
  };
}
