import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { resetEnvCache } from "@/lib/env";
import { consumeNonce, createNonce, resetNonces } from "@/server/security/nonce";
import { rateLimit, resetRateLimits } from "@/server/security/ratelimit";
import { assessReferralCluster, hasRiskFlags, mergeRiskFlags } from "@/server/security/fraud";
import { clientIp, hashIp, normalizeIp } from "@/server/security/ip";
import { adminCallbackData, parseAdminCallback, signAdminAction, verifyAdminCallback } from "@/server/telegram/sign";

beforeAll(() => {
  process.env.WEBHOOK_SECRET = "test-webhook-secret";
  resetEnvCache();
});

describe("single-use nonces", () => {
  it("accepts a nonce once and rejects a replay", async () => {
    resetNonces();
    expect(await consumeNonce("tap", 1, "nonce:abc")).toBe(true);
    expect(await consumeNonce("tap", 1, "nonce:abc")).toBe(false);
  });

  it("scopes nonces by purpose and user", async () => {
    resetNonces();
    expect(await consumeNonce("tap", 1, "shared-nonce")).toBe(true);
    expect(await consumeNonce("heartbeat", 1, "shared-nonce")).toBe(true);
    expect(await consumeNonce("tap", 2, "shared-nonce")).toBe(true);
  });

  it("creates prefixed random nonces", () => {
    const a = createNonce("mock_7");
    const b = createNonce("mock_7");
    expect(a.startsWith("mock_7_")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("rate limiting", () => {
  it("blocks a caller after the limit inside the window", async () => {
    resetRateLimits();
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await rateLimit("tap:1", 3, 60));
    }

    expect(results.slice(0, 3).every((result) => result.allowed)).toBe(true);
    expect(results[3]?.allowed).toBe(false);
    expect(results[3]?.remaining).toBe(0);
    expect(results[3]?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps independent buckets per key", async () => {
    resetRateLimits();
    expect((await rateLimit("route:a", 1, 60)).allowed).toBe(true);
    expect((await rateLimit("route:a", 1, 60)).allowed).toBe(false);
    expect((await rateLimit("route:b", 1, 60)).allowed).toBe(true);
  });
});

describe("referral cluster heuristics", () => {
  it("freezes a cluster when any signal fires", () => {
    expect(assessReferralCluster({
      signupsFromIp24h: 5,
      accountAgeHours: 10,
      sharedFingerprintAccounts: 0,
      inviteeQualified: true,
      inviteeTaps: 0,
    })).toEqual({
      flags: ["IP_CLUSTER_5_PER_24H", "NEW_TELEGRAM_ACCOUNT"],
      freeze: true,
    });
  });

  it("leaves a clean referral alone", () => {
    const result = assessReferralCluster({
      signupsFromIp24h: 1,
      accountAgeHours: 400,
      sharedFingerprintAccounts: 1,
      inviteeQualified: true,
      inviteeTaps: 2_000,
    });
    expect(result.freeze).toBe(false);
    expect(result.flags).toHaveLength(0);
  });

  it("flags accounts stuck before qualification", () => {
    const result = assessReferralCluster({
      signupsFromIp24h: 0,
      accountAgeHours: 500,
      sharedFingerprintAccounts: 0,
      inviteeQualified: false,
      inviteeTaps: 6_000,
    });
    expect(result.flags).toContain("STUCK_BEFORE_QUALIFICATION");
  });

  it("merges flags without dropping existing evidence", () => {
    const merged = mergeRiskFlags({ OLD: { at: "x" } }, ["NEW"], { reason: "cluster" });
    expect(Object.keys(merged).sort()).toEqual(["NEW", "OLD"]);
    expect(hasRiskFlags(merged)).toBe(true);
    expect(hasRiskFlags({})).toBe(false);
  });
});

describe("ip clustering", () => {
  it("normalizes IPv4 to /24 and IPv6 to /64", () => {
    expect(normalizeIp("203.0.113.45")).toBe("203.0.113.0/24");
    expect(normalizeIp("2001:db8:abcd:1234:5678::1")).toBe("2001:db8:abcd:1234::/64");
  });

  it("prefers the first forwarded address", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    expect(clientIp(headers)).toBe("198.51.100.7");
  });

  it("hashes IPs deterministically without exposing them", () => {
    const a = hashIp(new Headers({ "x-forwarded-for": "198.51.100.7" }));
    const b = hashIp(new Headers({ "x-forwarded-for": "203.0.113.9" }));
    const c = hashIp(new Headers({ "x-forwarded-for": "198.51.100.7" }));

    expect(a).toBe(c);
    expect(a).not.toBe(b);
    expect(a).toHaveLength(32);
    expect(a).not.toContain("198");
  });
});

describe("admin callback signatures", () => {
  it("round-trips a signed action", () => {
    const now = new Date();
    const data = adminCallbackData(7, "approve", now);
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseAdminCallback(data)).toMatchObject({
      redemptionId: 7,
      action: "approve",
      signature: signAdminAction(7, "approve", Math.floor(now.getTime() / 1000)),
    });
    expect(verifyAdminCallback(data, 900, now)).toEqual({ redemptionId: 7, action: "approve" });
  });

  it("rejects an expired signature", () => {
    const now = new Date();
    const data = adminCallbackData(7, "reject", now);
    const later = new Date(now.getTime() + 901_000);
    const error = (() => {
      try {
        verifyAdminCallback(data, 900, later);
      } catch (cause) {
        return cause;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("UNAUTHORIZED");
  });

  it("rejects a tampered action or signature", () => {
    const now = new Date();
    const data = adminCallbackData(7, "approve", now);
    const tampered = data.replace(":a:", ":r:");
    expect(() => verifyAdminCallback(tampered, 900, now)).toThrow(AppError);
    expect(parseAdminCallback("nonsense")).toBeNull();
  });
});
