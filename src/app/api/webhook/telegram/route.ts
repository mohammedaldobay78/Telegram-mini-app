import { z } from "zod";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { errorResponse, json, verifyWebhookSecret } from "@/server/http/route";
import { handleTelegramUpdate } from "@/server/telegram/bot";

const updateSchema = z.object({ update_id: z.number().int().positive() }).passthrough();

/** PLAN �?6, �?7.3: grammY webhook, secret header, idempotent by update_id. */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  try {
    verifyWebhookSecret(req);
    const raw = await req.json().catch(() => null);
    const update = updateSchema.parse(raw);
    const result = await handleTelegramUpdate(update as never);
    return json({ ok: true, ...result });
  } catch (error) {
    const response = errorResponse(error, requestId, "webhook.telegram");
    if (error instanceof AppError) {
      logger.warn("telegram_webhook_rejected", { request_id: requestId, code: error.code });
    }
    return response;
  }
}
