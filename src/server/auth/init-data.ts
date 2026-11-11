import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";

export const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean().optional(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  is_premium: z.boolean().optional(),
  photo_url: z.string().url().optional(),
  allows_write_to_pm: z.boolean().optional(),
});

export const initDataSchema = z.object({
  query_id: z.string().optional(),
  user: telegramUserSchema,
  auth_date: z.number().int().positive(),
  hash: z.string().length(64),
  start_param: z.string().max(512).optional(),
  chat_instance: z.string().optional(),
  chat_type: z.string().optional(),
  signature: z.string().optional(),
});

export type InitData = z.infer<typeof initDataSchema>;
export type TelegramUser = z.infer<typeof telegramUserSchema>;

export interface ValidateOptions {
  botToken: string;
  now?: Date;
  maxAgeSeconds?: number;
}

interface CacheEntry {
  value: InitData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 2_000;

/**
 * PLAN §7.2 / §10.3. The raw initData string is the only identity source.
 * `initDataUnsafe` is never trusted.
 */
export function validateInitData(raw: string, options: ValidateOptions): InitData {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_384) {
    throw new AppError("UNAUTHORIZED", "Missing Telegram init data");
  }
  if (!options.botToken) {
    throw new AppError("CONFIG_ERROR", "BOT_TOKEN is not configured");
  }

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new AppError("INVALID_INIT_DATA", "initData hash is missing or malformed");
  }

  const now = options.now ?? new Date();
  const maxAge = options.maxAgeSeconds ?? 3_600;

  if (verify(raw, hash, options.botToken)) {
    // signature valid
  } else {
    throw new AppError("INVALID_INIT_DATA", "initData signature is invalid", { status: 401 });
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    throw new AppError("INVALID_INIT_DATA", "initData auth_date is invalid");
  }
  if (now.getTime() / 1000 - authDate > maxAge) {
    throw new AppError("STALE_INIT_DATA", "initData is too old", { retryable: true });
  }
  if (authDate - now.getTime() / 1000 > 60) {
    throw new AppError("INVALID_INIT_DATA", "initData auth_date is in the future");
  }

  const cached = cache.get(hash);
  if (cached && cached.expiresAt > now.getTime()) return cached.value;

  const userJson = params.get("user");
  if (!userJson) throw new AppError("INVALID_INIT_DATA", "initData user is missing");

  let user: unknown;
  try {
    user = JSON.parse(userJson);
  } catch {
    throw new AppError("INVALID_INIT_DATA", "initData user is not valid JSON");
  }

  const parsed = initDataSchema.safeParse({
    query_id: params.get("query_id") ?? undefined,
    user,
    auth_date: authDate,
    hash,
    start_param: params.get("start_param") ?? undefined,
    chat_instance: params.get("chat_instance") ?? undefined,
    chat_type: params.get("chat_type") ?? undefined,
    signature: params.get("signature") ?? undefined,
  });

  if (!parsed.success) {
    throw new AppError("INVALID_INIT_DATA", "initData payload is malformed", {
      details: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
    });
  }

  const ttl = Math.min(60_000, maxAge * 1000);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(hash, { value: parsed.data, expiresAt: now.getTime() + ttl });
  return parsed.data;
}

export function verify(raw: string, hash: string, botToken: string): boolean {
  const params = new URLSearchParams(raw);
  const entries = [...params.entries()].filter(([key]) => key !== "hash");

  const checkStrings = [buildCheckString(entries)];
  if (params.has("signature")) {
    // Some clients include the Ed25519 `signature` field; it is not part of the
    // legacy HMAC payload. Accept the canonical variant too.
    checkStrings.push(buildCheckString(entries.filter(([key]) => key !== "signature")));
  }

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const provided = Buffer.from(hash, "hex");
  if (provided.length !== 32) return false;

  return checkStrings.some((checkString) => {
    const expected = createHmac("sha256", secretKey).update(checkString).digest();
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  });
}

function buildCheckString(entries: [string, string][]): string {
  return entries
    .slice()
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function extractInitData(headers: Headers): string | null {
  const header = headers.get("x-telegram-init-data") ?? headers.get("X-Telegram-Init-Data");
  if (header) return header;
  const authorization = headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("tma ")) return authorization.slice(4).trim();
  return null;
}

export function clearInitDataCache(): void {
  cache.clear();
}

/**
 * Referral payload lives in `start_param` (`ref_<code>`), PLAN §7.4.
 */
export function parseReferralParam(startParam: string | undefined): string | null {
  if (!startParam) return null;
  if (!startParam.startsWith("ref_")) return null;
  const code = startParam.slice(4).trim();
  return /^[a-zA-Z0-9_-]{4,64}$/.test(code) ? code : null;
}
