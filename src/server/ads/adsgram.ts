import { timingSafeEqual } from "node:crypto";
import { createNonce } from "@/server/security/nonce";
import type { AdPostback, AdProvider } from "./provider";
import { getEnv } from "@/lib/env";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * PLAN §8. Client claim is not sufficient at scale: the authoritative reward
 * arrives through the server postback (`/api/adsgram/reward`). The nonce ties
 * the client SDK session to the postback row.
 */
export const adsgramAdProvider: AdProvider = {
  id: "adsgram",
  async createNonce(userId: string): Promise<string> {
    return createNonce(`adsgram_${userId}`);
  },
  async verifyClientClaim(): Promise<boolean> {
    return false;
  },
  async verifyServerPostback(req: Request): Promise<AdPostback | null> {
    const env = getEnv();
    if (!env.ADSGRAM_SECRET) return null;
    const url = new URL(req.url);
    const secret = url.searchParams.get("secret") ?? "";
    if (!secret || !safeEqual(secret, env.ADSGRAM_SECRET)) return null;
    const userId = url.searchParams.get("userid") ?? url.searchParams.get("userId");
    if (!userId || !/^\d{1,20}$/.test(userId)) return null;
    return { userId, ok: true, nonce: url.searchParams.get("nonce") ?? undefined };
  },
};
