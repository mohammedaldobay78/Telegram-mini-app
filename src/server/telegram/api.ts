import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export async function callTelegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = getEnv().BOT_TOKEN;
  if (!token) throw new AppError("CONFIG_ERROR", "BOT_TOKEN is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !body.ok || body.result === undefined) {
      logger.error("telegram_api_error", { method, status: response.status, description: body.description });
      throw new AppError("UPSTREAM_ERROR", body.description ?? `Telegram ${method} failed`, {
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    return body.result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UPSTREAM_ERROR", `Telegram ${method} request failed`, { retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
}

export async function sendMessage(input: {
  chatId: number | string;
  text: string;
  replyMarkup?: unknown;
  parseMode?: "HTML" | "MarkdownV2";
}): Promise<TelegramMessage> {
  return callTelegram<TelegramMessage>("sendMessage", {
    chat_id: input.chatId,
    text: input.text.slice(0, 4096),
    ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    disable_web_page_preview: true,
  });
}

export interface StarGift {
  id: string;
  star_count: number;
  total_count?: number;
  remaining_count?: number;
}

export async function getAvailableGifts(): Promise<StarGift[]> {
  const result = await callTelegram<{ gifts: StarGift[] }>("getAvailableGifts", {});
  return result.gifts ?? [];
}

export async function getMyStarBalance(): Promise<number> {
  const result = await callTelegram<{ amount: number }>("getMyStarBalance", {});
  return result.amount;
}

export async function sendGift(input: {
  userId: number;
  giftId: string;
  text?: string;
}): Promise<boolean> {
  await callTelegram<true>("sendGift", {
    user_id: input.userId,
    gift_id: input.giftId,
    ...(input.text ? { text: input.text.slice(0, 255) } : {}),
  });
  return true;
}

export async function answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string): Promise<void> {
  await callTelegram<true>("answerPreCheckoutQuery", {
    pre_checkout_query_id: id,
    ok,
    ...(errorMessage ? { error_message: errorMessage.slice(0, 200) } : {}),
  });
}

export async function createInvoiceLink(input: {
  title: string;
  description: string;
  payload: string;
  stars: number;
}): Promise<string> {
  return callTelegram<string>("createInvoiceLink", {
    title: input.title,
    description: input.description,
    payload: input.payload,
    currency: "XTR",
    prices: [{ label: input.title, amount: input.stars }],
  });
}

export async function setWebhook(url: string, secretToken: string): Promise<boolean> {
  await callTelegram<true>("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query", "pre_checkout_query", "my_chat_member"],
    drop_pending_updates: false,
  });
  return true;
}

export async function getWebhookInfo(): Promise<Record<string, unknown>> {
  return callTelegram<Record<string, unknown>>("getWebhookInfo", {});
}

export async function setMyCommands(commands: { command: string; description: string }[]): Promise<boolean> {
  await callTelegram<true>("setMyCommands", { commands });
  return true;
}
