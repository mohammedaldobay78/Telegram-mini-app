import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { adsgramRewardQuerySchema } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { getDb } from "@/db/client";
import { getSettings } from "@/server/config/settings";
import { errorResponse, json } from "@/server/http/route";
import { adsgramAdProvider } from "@/server/ads/adsgram";
import { rateLimit } from "@/server/security/ratelimit";
import { computeUserMomentum } from "@/server/services/momentum";
import { creditAdsgramReward } from "@/server/services/ads";
import { findUserById, findUserByTelegramId } from "@/server/services/users";

/**
 * PLAN �?6, �?8: Adsgram server postback. Secret + `[userid]` only; the nonce
 * makes retries idempotent. If Adsgram does not echo the nonce we derive one
 * from the query string so an identical retry cannot double-pay.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  try {
    const postback = await adsgramAdProvider.verifyServerPostback(req);
    if (!postback) throw new AppError("UNAUTHORIZED", "Invalid Adsgram postback");

    const url = new URL(req.url);
    const query = adsgramRewardQuerySchema.parse({
      userid: url.searchParams.get("userid") ?? url.searchParams.get("userId") ?? "",
      secret: url.searchParams.get("secret") ?? undefined,
      nonce: url.searchParams.get("nonce") ?? undefined,
      reward: url.searchParams.get("reward") ?? undefined,
    });

    const limit = await rateLimit(`adsgram:${query.userid}`, 60, 60);
    if (!limit.allowed) throw new AppError("RATE_LIMITED", "Too many postbacks", { retryable: true });

    const db = getDb();
    const settings = await getSettings();
    const numeric = Number(query.userid);
    const user = (await findUserById(db, numeric)) ?? (await findUserByTelegramId(db, numeric));
    if (!user) throw new AppError("NOT_FOUND", "Unknown user");

    const nonce =
      query.nonce ??
      `pb_${createHash("sha256").update(url.search).digest("hex").slice(0, 40)}`;

    const { momentum } = await computeUserMomentum(db, user, settings, new Date());
    const result = await creditAdsgramReward(db, user, settings, nonce, momentum.total, new Date());
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error, requestId, "adsgram.reward");
  }
}
