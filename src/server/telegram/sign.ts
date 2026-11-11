import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type AdminAction = "approve" | "reject";

function secret(): string {
  const value = getEnv().WEBHOOK_SECRET;
  if (!value) throw new AppError("CONFIG_ERROR", "WEBHOOK_SECRET is not configured");
  return value;
}

export function signAdminAction(redemptionId: number, action: AdminAction, at: number): string {
  return createHmac("sha256", secret())
    .update(`${redemptionId}:${action}:${at}`)
    .digest("hex")
    .slice(0, 20);
}

/** Telegram callback_data is limited to 64 bytes: `ar:<id>:<action>:<at>:<sig>`. */
export function adminCallbackData(redemptionId: number, action: AdminAction, now: Date): string {
  const at = Math.floor(now.getTime() / 1000);
  return `ar:${redemptionId}:${action === "approve" ? "a" : "r"}:${at}:${signAdminAction(redemptionId, action, at)}`;
}

export function parseAdminCallback(data: string): { redemptionId: number; action: AdminAction; at: number; signature: string } | null {
  const parts = data.split(":");
  if (parts.length !== 5 || parts[0] !== "ar") return null;
  const redemptionId = Number(parts[1]);
  const action = parts[2] === "a" ? "approve" : parts[2] === "r" ? "reject" : null;
  const at = Number(parts[3]);
  const signature = parts[4];
  if (!Number.isSafeInteger(redemptionId) || !action || !Number.isSafeInteger(at) || !signature) return null;
  return { redemptionId, action, at, signature };
}

export function verifyAdminCallback(data: string, maxAgeSeconds = 900, now = new Date()): {
  redemptionId: number;
  action: AdminAction;
} {
  const parsed = parseAdminCallback(data);
  if (!parsed) throw new AppError("UNAUTHORIZED", "Malformed admin callback");
  return verifyAdminParts(parsed.redemptionId, parsed.action, parsed.at, parsed.signature, maxAgeSeconds, now);
}

/** Same checks for the HTTP admin route, where the fields arrive separately. */
export function verifyAdminParts(
  redemptionId: number,
  action: AdminAction,
  at: number,
  signature: string,
  maxAgeSeconds = 900,
  now = new Date(),
): { redemptionId: number; action: AdminAction } {
  if (!Number.isSafeInteger(redemptionId) || redemptionId <= 0 || !Number.isSafeInteger(at)) {
    throw new AppError("UNAUTHORIZED", "Malformed admin signature");
  }
  if (now.getTime() / 1000 - at > maxAgeSeconds) {
    throw new AppError("UNAUTHORIZED", "Admin signature has expired");
  }
  const expected = signAdminAction(redemptionId, action, at);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new AppError("UNAUTHORIZED", "Invalid admin signature");
  }
  return { redemptionId, action };
}
