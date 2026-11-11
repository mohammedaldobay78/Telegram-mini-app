export interface ReferralClusterInput {
  signupsFromIp24h: number;
  accountAgeHours: number;
  sharedFingerprintAccounts: number;
  inviteeQualified: boolean;
  inviteeTaps: number;
}

export interface ClusterAssessment {
  flags: string[];
  freeze: boolean;
}

/**
 * PLAN §10.4: freeze (never auto-ban) a referral cluster on any of these
 * signals. Freezes are written to `anomalies` for admin review.
 */
export function assessReferralCluster(input: ReferralClusterInput): ClusterAssessment {
  const flags: string[] = [];
  if (input.signupsFromIp24h >= 5) flags.push("IP_CLUSTER_5_PER_24H");
  if (input.accountAgeHours < 48) flags.push("NEW_TELEGRAM_ACCOUNT");
  if (input.sharedFingerprintAccounts >= 3) flags.push("SHARED_DEVICE_FINGERPRINT");
  if (!input.inviteeQualified && input.inviteeTaps > 5_000) flags.push("STUCK_BEFORE_QUALIFICATION");

  return { flags, freeze: flags.length > 0 };
}

export function mergeRiskFlags(
  existing: Record<string, unknown>,
  flags: string[],
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  if (flags.length === 0) return existing;
  const next: Record<string, unknown> = { ...existing };
  for (const flag of flags) {
    next[flag] = { ...metadata, at: new Date().toISOString() };
  }
  return next;
}

export function hasRiskFlags(flags: Record<string, unknown>): boolean {
  return Object.keys(flags).length > 0;
}
