import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { adminIds, getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getDb } from "@/db/client";
import { extractInitData, parseReferralParam, validateInitData } from "@/server/auth/init-data";
import { getSettings } from "@/server/config/settings";
import { hashIp } from "@/server/security/ip";
import { rateLimit } from "@/server/security/ratelimit";
import { applyReferral } from "@/server/services/referrals";
import { buildState } from "@/server/services/state";
import { toPublicUser, upsertTelegramUser } from "@/server/services/users";
import { errorResponse, json } from "@/server/http/route";

/** PLAN �?6, �?7.1–�?7.4: validate initData, upsert, apply referral, bootstrap. */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  try {
    const settings = await getSettings();
    const raw = extractInitData(req.headers);
    if (!raw) throw new AppError("UNAUTHORIZED", "Missing X-Telegram-Init-Data header");
    const token = getEnv().BOT_TOKEN;
    if (!token) throw new AppError("CONFIG_ERROR", "BOT_TOKEN is not configured");

    const initData = validateInitData(raw, {
      botToken: token,
      maxAgeSeconds: settings.security.auth_max_age_seconds,
    });

    const limit = await rateLimit(`auth:${initData.user.id}`, 10, 60);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many requests", {
        retryable: true,
        details: { retryAfterSeconds: limit.retryAfterSeconds },
      });
    }

    const db = getDb();
    const now = new Date();
    const { user, isNewUser } = await upsertTelegramUser(db, initData.user, {
      isAdmin: adminIds().includes(initData.user.id),
    });
    if (user.isBanned) throw new AppError("FORBIDDEN", "Account is restricted");

    let referralApplied = false;
    const code = parseReferralParam(initData.start_param);
    if (code) {
      referralApplied = await applyReferral(db, user.id, code, hashIp(req.headers));
    }

    const state = await buildState({ db, user, settings, now });
    logger.info("auth_complete", {
      request_id: requestId,
      telegram_id: user.telegramId,
      is_new: isNewUser,
      referral_applied: referralApplied,
    });

    return json(
      {
        user: toPublicUser(user),
        isNewUser,
        referralApplied,
        state,
      },
      200,
    );
  } catch (error) {
    return errorResponse(error, requestId, "auth.telegram");
  }
}
