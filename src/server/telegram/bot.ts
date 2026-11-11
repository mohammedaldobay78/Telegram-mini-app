import { and, eq } from "drizzle-orm";
import { Bot, type Context } from "grammy";
import type { Update } from "grammy/types";
import type { Database } from "@/db/client";
import { getDb } from "@/db/client";
import { redemptions, telegramUpdates, users } from "@/db/schema";
import { adminIds, getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getSettings } from "@/server/config/settings";
import { toPublicUser } from "@/server/services/users";
import { creditSuccessfulPayment, requireValidPack } from "@/server/services/stars";
import { adminDecideRedemption } from "@/server/services/redemption";
import { verifyAdminCallback } from "./sign";

let bot: Bot | null = null;
let initPromise: Promise<void> | null = null;

export function getBot(): Bot {
  if (bot) return bot;
  const token = getEnv().BOT_TOKEN;
  if (!token) throw new AppError("CONFIG_ERROR", "BOT_TOKEN is not configured");

  const instance = new Bot(token);
  registerHandlers(instance);
  bot = instance;
  return instance;
}

async function ensureInit(instance: Bot): Promise<void> {
  if (!initPromise) {
    initPromise = instance.init().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

function appButton(): { inline_keyboard: { text: string; web_app: { url: string } }[][] } {
  const url = getEnv().TELEGRAM_WEBAPP_URL ?? "https://example.com";
  return { inline_keyboard: [[{ text: "Open Earn Money", web_app: { url } }]] };
}

async function isAdminUser(db: Database, telegramId: number): Promise<boolean> {
  if (adminIds().includes(telegramId)) return true;
  const [row] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return Boolean(row?.isAdmin);
}

async function reply(ctx: Context, text: string, markup?: unknown): Promise<void> {
  await ctx.reply(text, {
    link_preview_options: { is_disabled: true },
    ...(markup ? { reply_markup: markup as never } : {}),
  });
}

function registerHandlers(instance: Bot): void {
  instance.command("start", async (ctx) => {
    const payload = ctx.match?.trim() ?? "";
    const lines = [
      "Welcome to Earn Money.",
      "Tap, watch rewarded ads, rent offline workers and invite friends to earn coins.",
      "Coins can be redeemed for Telegram gifts from the wallet.",
    ];
    if (payload.startsWith("ref_")) {
      lines.push("Your referral code will be applied when you open the app for the first time.");
    }
    await reply(ctx, lines.join("\n"), appButton());
  });

  instance.command("app", async (ctx) => {
    await reply(ctx, "Open the Mini App to keep earning.", appButton());
  });

  instance.command("help", async (ctx) => {
    await reply(
      ctx,
      [
        "How it works:",
        "� Tap to earn coins (energy refills every minute).",
        "� Watch rewarded ads for extra coins.",
        "� Rent workers for offline income.",
        "� Invite friends for 10% of their earnings.",
        "� Redeem coins for Telegram gifts in the wallet.",
        "",
        "Commands: /app /balance /help",
      ].join("\n"),
      appButton(),
    );
  });

  instance.command("balance", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const db = getDb();
    const [row] = await db.select().from(users).where(eq(users.telegramId, from.id)).limit(1);
    if (!row) {
      await reply(ctx, "Open the Mini App first, then try /balance again.", appButton());
      return;
    }
    const publicUser = toPublicUser(row);
    await reply(
      ctx,
      [
        `Balance: ${publicUser.balance.toLocaleString("en-US")} coins`,
        `Lifetime earned: ${publicUser.lifetimeCoinsEarned.toLocaleString("en-US")} coins`,
        `Streak: ${row.streakDays} days`,
      ].join("\n"),
      appButton(),
    );
  });

  instance.command("admin", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const db = getDb();
    if (!(await isAdminUser(db, from.id))) {
      await reply(ctx, "Not available.");
      return;
    }
    const queue = await db
      .select({
        id: redemptions.id,
        coins: redemptions.coins,
        stars: redemptions.stars,
        giftId: redemptions.giftId,
        userId: redemptions.userId,
      })
      .from(redemptions)
      .where(eq(redemptions.status, "requested"))
      .limit(10);

    if (queue.length === 0) {
      await reply(ctx, "No pending redemptions.");
      return;
    }
    const lines = queue.map(
      (row) => `#${row.id} user=${row.userId} ${row.giftId} ${row.stars} Stars (${Number(row.coins).toLocaleString("en-US")} coins)`,
    );
    await reply(ctx, ["Pending redemptions:", ...lines].join("\n"));
  });

  /** PLAN �?7.5.2: answer pre-checkout within 10 s, validate the payload only. */
  instance.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    try {
      const settings = await getSettings();
      const parts = query.invoice_payload.split(":");
      if (parts.length < 3 || parts[0] !== "coins" || !parts[1]) {
        await ctx.answerPreCheckoutQuery(false, "Unknown product");
        return;
      }
      const pack = requireValidPack(settings, parts[1]);
      if (query.currency !== "XTR" || query.total_amount !== pack.stars) {
        await ctx.answerPreCheckoutQuery(false, "Price changed, please reopen the wallet");
        return;
      }
      await ctx.answerPreCheckoutQuery(true);
    } catch (error) {
      logger.error("pre_checkout_failed", { error: String(error) });
      await ctx.answerPreCheckoutQuery(false, "This product is temporarily unavailable").catch(() => undefined);
    }
  });

  /** PLAN �?7.5.3: never trust the client; the update is the receipt. */
  instance.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const from = ctx.from;
    if (!from) return;
    const settings = await getSettings();
    const result = await creditSuccessfulPayment(
      getDb(),
      settings,
      {
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        invoicePayload: payment.invoice_payload,
        currency: payment.currency,
        totalAmount: payment.total_amount,
        telegramUserId: from.id,
      },
      new Date(),
    );
    if (result.credited) {
      await reply(
        ctx,
        `Payment received. ${result.coins.toLocaleString("en-US")} coins were added. New balance: ${result.balance.toLocaleString("en-US")}.`,
        appButton(),
      );
    }
  });

  instance.on("callback_query:data", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    try {
      const db = getDb();
      if (!(await isAdminUser(db, from.id))) {
        await ctx.answerCallbackQuery({ text: "Not authorized", show_alert: false });
        return;
      }
      const settings = await getSettings();
      const decision = verifyAdminCallback(ctx.callbackQuery.data, settings.security.admin_callback_max_age_seconds);
      const result = await adminDecideRedemption(
        db,
        decision.redemptionId,
        decision.action,
        from.id,
        settings,
        new Date(),
      );
      await ctx.answerCallbackQuery({ text: `Redemption #${result.id} ${result.status}` });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    } catch (error) {
      logger.error("admin_callback_failed", { error: String(error) });
      const message = error instanceof AppError ? error.message : "Action failed";
      await ctx.answerCallbackQuery({ text: message.slice(0, 180), show_alert: true }).catch(() => undefined);
    }
  });

  instance.catch((error) => {
    logger.error("bot_update_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export interface WebhookResult {
  duplicate: boolean;
  processed: boolean;
}

/**
 * Webhook entry point. Idempotent by `update_id` (PLAN �?6): the claim row is
 * inserted first, and removed if processing throws so Telegram's retry works.
 */
export async function handleTelegramUpdate(update: Update): Promise<WebhookResult> {
  const db = getDb();
  const claimed = await db
    .insert(telegramUpdates)
    .values({ updateId: update.update_id })
    .onConflictDoNothing({ target: telegramUpdates.updateId })
    .returning({ updateId: telegramUpdates.updateId });

  if (claimed.length === 0) return { duplicate: true, processed: false };

  try {
    const instance = getBot();
    await ensureInit(instance);
    await instance.handleUpdate(update);
    return { duplicate: false, processed: true };
  } catch (error) {
    await db
      .delete(telegramUpdates)
      .where(and(eq(telegramUpdates.updateId, update.update_id)))
      .catch(() => undefined);
    throw error;
  }
}

/** Used by tests and the local webhook simulator. */
export function resetBot(): void {
  bot = null;
  initPromise = null;
}
