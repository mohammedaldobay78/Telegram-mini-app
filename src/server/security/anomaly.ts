import type { SecuritySettings } from "@/server/config/settings";

export interface TapStats {
  sampleSize: number;
  meanMs: number;
  stdevMs: number;
  cv: number;
}

export function interTapStats(intervals: number[]): TapStats {
  const values = intervals.filter((value) => Number.isFinite(value) && value >= 0);
  const sampleSize = values.length;
  if (sampleSize === 0) return { sampleSize: 0, meanMs: 0, stdevMs: 0, cv: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / sampleSize;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sampleSize;
  const stdev = Math.sqrt(variance);
  return {
    sampleSize,
    meanMs: mean,
    stdevMs: stdev,
    cv: mean > 0 ? stdev / mean : 0,
  };
}

/**
 * PLAN §10.3: perfectly regular taps (CV < 0.05) are flagged and lose the
 * day's duration bonus. A minimum sample avoids punishing new users.
 */
export function isMacroLike(intervals: number[], threshold: number, minSamples = 8): boolean {
  const stats = interTapStats(intervals);
  return stats.sampleSize >= minSamples && stats.meanMs > 0 && stats.cv < threshold;
}

export interface TapBatchAssessment {
  flagged: boolean;
  reasons: string[];
  allowedTaps: number;
}

export function assessTapBatch(input: {
  taps: number;
  interTapMs: number[] | undefined;
  settings: SecuritySettings;
}): TapBatchAssessment {
  const reasons: string[] = [];
  let allowedTaps = Math.min(input.taps, input.settings.max_taps_per_request);

  if (input.taps > input.settings.max_taps_per_request) {
    reasons.push("TAP_BATCH_OVER_CEILING");
  }

  const intervals = input.interTapMs ?? [];
  if (intervals.length > 0) {
    const stats = interTapStats(intervals);
    if (stats.meanMs > 0 && stats.meanMs < input.settings.min_tap_interval_ms) {
      reasons.push("TAP_INTERVAL_TOO_FAST");
    }
    if (isMacroLike(intervals, input.settings.tap_cv_threshold)) {
      reasons.push("TAP_CADENCE_TOO_REGULAR");
    }
  }

  return { flagged: reasons.length > 0, reasons, allowedTaps };
}

export function withinDailyCap(earnedToday: number, requested: number, dailyCap: number): number {
  return Math.max(0, Math.min(requested, dailyCap - earnedToday));
}

export interface HeartbeatInput {
  now: Date;
  clientTs: number;
  visible: boolean;
  lastInteractionAt: Date | null;
  windowSeconds: number;
}

export function validateHeartbeat(input: HeartbeatInput): { valid: boolean; reason?: string; creditedSeconds: number } {
  if (!input.visible) return { valid: false, reason: "HEARTBEAT_HIDDEN", creditedSeconds: 0 };

  const ageMs = input.now.getTime() - input.clientTs;
  if (ageMs < -60_000 || ageMs > input.windowSeconds * 2 * 1000) {
    return { valid: false, reason: "HEARTBEAT_STALE", creditedSeconds: 0 };
  }
  if (!input.lastInteractionAt) {
    return { valid: false, reason: "HEARTBEAT_NO_INTERACTION", creditedSeconds: 0 };
  }
  const sinceInteraction = input.now.getTime() - input.lastInteractionAt.getTime();
  if (sinceInteraction > input.windowSeconds * 1000) {
    return { valid: false, reason: "HEARTBEAT_NO_RECENT_INTERACTION", creditedSeconds: 0 };
  }

  return { valid: true, creditedSeconds: Math.min(input.windowSeconds, Math.max(0, Math.floor(ageMs / 1000))) };
}

export function clampDailyMinutes(existingSeconds: number, addSeconds: number, maxMinutes: number): number {
  const maxSeconds = maxMinutes * 60;
  return Math.max(0, Math.min(addSeconds, maxSeconds - existingSeconds));
}
