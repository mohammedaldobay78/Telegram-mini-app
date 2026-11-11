import { AppError } from "@/lib/errors";
import type { EconomySettings } from "@/server/config/settings";

export interface EnergyLevels {
  energyCapLevel: number;
  regenLevel: number;
}

export interface EnergySnapshot {
  energy: number;
  cap: number;
  regenSeconds: number;
  energyUpdatedAt: Date;
  nextRegenInSeconds: number;
}

export function energyCap(settings: EconomySettings, level: number): number {
  const safeLevel = clampLevel(level, settings.energy_cap_max_level);
  return settings.energy_cap + safeLevel * settings.energy_cap_step;
}

export function regenSeconds(settings: EconomySettings, level: number): number {
  const safeLevel = clampLevel(level, settings.regen_max_level);
  return Math.max(1, Math.round(settings.regen_seconds * Math.pow(1 - settings.regen_step_pct, safeLevel)));
}

/**
 * Energy is derived from the server clock only. `energy_updated_at` anchors the
 * last time energy was written. PLAN §2.2, §10.3.
 */
export function computeEnergy(
  settings: EconomySettings,
  levels: EnergyLevels,
  storedEnergy: number,
  energyUpdatedAt: Date,
  now: Date,
): EnergySnapshot {
  const cap = energyCap(settings, levels.energyCapLevel);
  const seconds = regenSeconds(settings, levels.regenLevel);

  const clampedStored = Math.min(Math.max(Math.floor(storedEnergy), 0), cap);
  const elapsedMs = Math.max(0, now.getTime() - energyUpdatedAt.getTime());
  const gained = Math.floor(elapsedMs / (seconds * 1000));
  const energy = Math.min(cap, clampedStored + gained);

  let nextUpdatedAt: Date;
  if (energy >= cap) {
    nextUpdatedAt = now;
  } else {
    nextUpdatedAt = new Date(energyUpdatedAt.getTime() + gained * seconds * 1000);
  }

  const remainderMs = energy >= cap ? 0 : Math.max(0, now.getTime() - nextUpdatedAt.getTime());
  const nextRegenInSeconds = energy >= cap ? 0 : Math.max(0, seconds - Math.floor(remainderMs / 1000));

  return {
    energy,
    cap,
    regenSeconds: seconds,
    energyUpdatedAt: nextUpdatedAt,
    nextRegenInSeconds,
  };
}

export function consumeEnergy(snapshot: EnergySnapshot, taps: number): EnergySnapshot {
  if (!Number.isSafeInteger(taps) || taps <= 0) {
    throw new AppError("VALIDATION_ERROR", "taps must be a positive integer");
  }
  if (taps > snapshot.energy) {
    throw new AppError("INSUFFICIENT_ENERGY", "Not enough energy for this tap batch", {
      details: { available: snapshot.energy, requested: taps, nextRegenInSeconds: snapshot.nextRegenInSeconds },
    });
  }
  const energy = snapshot.energy - taps;
  const wasFull = snapshot.energy >= snapshot.cap;
  return {
    ...snapshot,
    energy,
    energyUpdatedAt: wasFull ? new Date(snapshot.energyUpdatedAt) : snapshot.energyUpdatedAt,
    nextRegenInSeconds: energy >= snapshot.cap ? 0 : snapshot.nextRegenInSeconds,
  };
}

export function fillEnergy(settings: EconomySettings, levels: EnergyLevels, now: Date): EnergySnapshot {
  const cap = energyCap(settings, levels.energyCapLevel);
  return {
    energy: cap,
    cap,
    regenSeconds: regenSeconds(settings, levels.regenLevel),
    energyUpdatedAt: now,
    nextRegenInSeconds: 0,
  };
}

function clampLevel(level: number, max: number): number {
  return Math.min(Math.max(Math.floor(level), 0), Math.max(0, max));
}
