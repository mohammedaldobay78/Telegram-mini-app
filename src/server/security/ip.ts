import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";

/** Coarse client IP used only for abuse clustering, never for identity. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const raw = forwarded?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? "0.0.0.0";
  return raw;
}

/** /24 for IPv4, /64 for IPv6 (PLAN §10.4). */
export function normalizeIp(ip: string): string {
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 4).join(":") + "::/64";
  }
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  return ip;
}

export function hashIp(headers: Headers): string {
  const ip = normalizeIp(clientIp(headers));
  const secret = getEnv().WEBHOOK_SECRET ?? "local-ip-pepper";
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}
