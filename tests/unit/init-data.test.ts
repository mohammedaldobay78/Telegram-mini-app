import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  clearInitDataCache,
  parseReferralParam,
  validateInitData,
} from "@/server/auth/init-data";

const BOT_TOKEN = "123456:test-token-for-signing";
const NOW = new Date("2026-01-10T12:00:00.000Z");

function sign(params: Record<string, string>, token = BOT_TOKEN): string {
  const checkString = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

function baseParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 10),
    query_id: "AAH-test",
    user: JSON.stringify({ id: 42, first_name: "Ada", username: "ada" }),
    ...overrides,
  };
}

describe("validateInitData", () => {
  it("accepts a correctly signed payload", () => {
    clearInitDataCache();
    const raw = sign(baseParams({ start_param: "ref_abc123" }));
    const result = validateInitData(raw, { botToken: BOT_TOKEN, now: NOW });
    expect(result.user.id).toBe(42);
    expect(result.user.first_name).toBe("Ada");
    expect(result.start_param).toBe("ref_abc123");
  });

  it("rejects a tampered payload", () => {
    clearInitDataCache();
    const raw = sign(baseParams());
    const tampered = raw.replace(encodeURIComponent("Ada"), encodeURIComponent("Mallory"));
    expect(() => validateInitData(tampered, { botToken: BOT_TOKEN, now: NOW })).toThrow(AppError);
  });

  it("rejects a signature made with a different bot token", () => {
    clearInitDataCache();
    const raw = sign(baseParams(), "999:other-token");
    expect(() => validateInitData(raw, { botToken: BOT_TOKEN, now: NOW })).toThrow(AppError);
  });

  it("rejects stale init data", () => {
    clearInitDataCache();
    const raw = sign(baseParams({ auth_date: String(Math.floor(NOW.getTime() / 1000) - 7_200) }));
    const error = (() => {
      try {
        validateInitData(raw, { botToken: BOT_TOKEN, now: NOW });
      } catch (cause) {
        return cause;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("STALE_INIT_DATA");
  });

  it("rejects auth_date in the future", () => {
    clearInitDataCache();
    const raw = sign(baseParams({ auth_date: String(Math.floor(NOW.getTime() / 1000) + 300) }));
    expect(() => validateInitData(raw, { botToken: BOT_TOKEN, now: NOW })).toThrow(AppError);
  });

  it("rejects a missing hash", () => {
    clearInitDataCache();
    const params = new URLSearchParams(baseParams());
    expect(() => validateInitData(params.toString(), { botToken: BOT_TOKEN, now: NOW })).toThrow(AppError);
  });
});

describe("parseReferralParam", () => {
  it("accepts ref_ codes and ignores other payloads", () => {
    expect(parseReferralParam("ref_abc123")).toBe("abc123");
    expect(parseReferralParam("ref_")).toBeNull();
    expect(parseReferralParam("promo_abc")).toBeNull();
    expect(parseReferralParam(undefined)).toBeNull();
    expect(parseReferralParam("ref_ab")).toBeNull();
  });
});
