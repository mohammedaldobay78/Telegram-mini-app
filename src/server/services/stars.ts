import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { payments, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Settings } from "@/server/config/settings";
import { packArbitrage } from "@/server/economy/pricing";
import { post } from "@/server/economy/ledger";
import type { UserRow } from "@/server/services/users";
import { createInvoiceLink } from "@/server/telegram/api";

/**
 * PLAN �?2.10 / �?7.5. Coin packs are the only thing sold for Stars. The
 * arbitrage rule is enforced when the invoice is created and again when the
 * payment is credited, so a stale settings row can never create free value.
 */

export interface CoinPackView {
  id: string;
  coins: number;
  stars: number;
  minimumStars: number;
  valid: boolean;
}

export function coinPacks(settings: Settings): CoinPackView[] {
  return settings.economy.coin_packs.map((pack) => {
    const arbitrage = packArbitrage(settings.economy, pack);
    return {
      id: pack.id,
      coins: pack.coins,
      stars: pack.stars,
      minimumStars: arbitrage.minimumStars,
      valid: arbitrage.valid,
    };
  });
}

export function requireValidPack(settings: Settings, packId: string): { id: string; coins: number; stars: number } {
  const pack = settings.economy.coin_packs.find((entry) => entry.id === packId);
  if (!pack) throw new AppError("NOT_FOUND", "Unknown coin pack");
  const arbitrage = packArbitrage(settings.economy, pack);
  if (!arbitrage.valid) {
    logger.error("coin_pack_arbitrage_violation", {
      packId: pack.id,
      stars: pack.stars,
      minimumStars: arbitrage.minimumStars,
    });
    throw new AppError("CONFIG_ERROR", "This pack is temporarily unavailable");
  }
  return pack;
}

export interface InvoiceResult {
  url: string;
  packId: string;
  coins: number;
  stars: number;
}

/**
 * Creates a Stars invoice. The payload is signed by Telegram on the way back
 * (it is embedded in the successful_payment update); the user id inside it is
 * compared with the authenticated user before crediting.
 */
export async function createPackInvoice(
  db: Database,
  user: UserRow,
  settings: Settings,
  packId: string,
): Promise<InvoiceResult> {
  const pack = requireValidPack(settings, packId);
  const nonce = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = `coins:${pack.id}:${user.id}:${nonce}`;

  const url = await createInvoiceLink({
    title: `${pack.coins.toLocaleString("en-US")} coins`,
    description: "Coins are credited instantly. Telegram Stars are non-refundable.",
    payload,
    stars: pack.stars,
  });

  return { url, packId: pack.id, coins: pack.coins, stars: pack.stars };
}

export interface SuccessfulPaymentInput {
  telegramPaymentChargeId: string;
  invoicePayload: string;
  currency: string;
  totalAmount: number;
  telegramUserId: number;
}

export interface CreditResult {
  credited: boolean;
  coins: number;
  balance: number;
  reason?: string;
}

function parsePayload(payload: string): { packId: string; userId: number } | null {
  const parts = payload.split(":");
  if (parts.length < 3 || parts[0] !== "coins") return null;
  const packId = parts[1];
  const userId = Number(parts[2]);
  if (!packId || !Number.isSafeInteger(userId) || userId <= 0) return null;
  return { packId, userId };
}

/**
 * PLAN �?7.5.3: verify `telegram_payment_charge_id` uniqueness and credit the
 * pack in one transaction. Amount comes from the Telegram update only.
 */
export async function creditSuccessfulPayment(
  db: Database,
  settings: Settings,
  input: SuccessfulPaymentInput,
  now: Date,
): Promise<CreditResult> {
  const parsed = parsePayload(input.invoicePayload);
  if (!parsed) {
    throw new AppError("VALIDATION_ERROR", "Unknown invoice payload");
  }

  const [owner] = await db.select({ id: users.id, telegramId: users.telegramId }).from(users).where(eq(users.id, parsed.userId)).limit(1);
  if (!owner || owner.telegramId !== input.telegramUserId) {
    throw new AppError("FORBIDDEN", "Payment does not belong to this user");
  }

  const pack = requireValidPack(settings, parsed.packId);
  if (input.currency !== "XTR" || input.totalAmount !== pack.stars) {
    logger.error("stars_payment_amount_mismatch", {
      payload: input.invoicePayload,
      expectedStars: pack.stars,
      receivedStars: input.totalAmount,
      currency: input.currency,
    });
    throw new AppError("CONFLICT", "Payment amount does not match the pack");
  }

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(payments)
      .values({
        userId: parsed.userId,
        telegramPaymentChargeId: input.telegramPaymentChargeId,
        stars: pack.stars,
        coins: pack.coins,
      })
      .onConflictDoNothing({ target: payments.telegramPaymentChargeId })
      .returning({ id: payments.id });

    if (!inserted) {
      const [current] = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, parsed.userId)).limit(1);
      return { credited: false, coins: 0, balance: Number(current?.balance ?? 0), reason: "DUPLICATE" };
    }

    const result = await post(tx, {
      userId: parsed.userId,
      delta: pack.coins,
      type: "stars_purchase",
      refId: input.telegramPaymentChargeId,
      idempotencyKey: `stars:${input.telegramPaymentChargeId}`,
      meta: { packId: pack.id, stars: pack.stars },
    });

    return { credited: true, coins: pack.coins, balance: result.balance };
  });
}
