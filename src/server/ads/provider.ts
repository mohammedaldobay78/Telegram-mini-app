export interface AdPostback {
  userId: string;
  ok: boolean;
  nonce?: string;
}

/** PLAN §8. Adsgram sits behind this interface; dev uses the mock. */
export interface AdProvider {
  id: "mock" | "adsgram";
  createNonce(userId: string): Promise<string>;
  verifyClientClaim(nonce: string, payload: unknown): Promise<boolean>;
  verifyServerPostback(req: Request): Promise<AdPostback | null>;
}

export interface AdStartPayload {
  nonce: string;
  provider: "mock" | "adsgram";
  blockId?: string;
}
