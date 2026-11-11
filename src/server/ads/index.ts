import { getEnv } from "@/lib/env";
import { adsgramAdProvider } from "./adsgram";
import { mockAdProvider } from "./mock";
import type { AdProvider } from "./provider";

export function getAdProvider(): AdProvider {
  return getEnv().AD_PROVIDER === "adsgram" ? adsgramAdProvider : mockAdProvider;
}

export { adsgramAdProvider, mockAdProvider };
export type { AdProvider, AdStartPayload } from "./provider";
