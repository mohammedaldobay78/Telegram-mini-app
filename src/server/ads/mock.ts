import { createNonce } from "@/server/security/nonce";
import type { AdPostback, AdProvider } from "./provider";

/** Dev-only provider. The UI labels it clearly (PLAN §8). */
export const mockAdProvider: AdProvider = {
  id: "mock",
  async createNonce(userId: string): Promise<string> {
    return createNonce(`mock_${userId}`);
  },
  async verifyClientClaim(): Promise<boolean> {
    return true;
  },
  async verifyServerPostback(): Promise<AdPostback | null> {
    return null;
  },
};
