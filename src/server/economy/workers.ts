import type { EconomySettings } from "@/server/config/settings";
import type { WorkerHours, WorkerTier } from "@/lib/types";
import { workerOutputPerHour, workerRentPrice } from "./store";

export interface WorkerRecord {
  id: number;
  userId: number;
  tier: number;
  rentalStartedAt: Date;
  rentalEndsAt: Date;
  lastCollectedAt: Date | null;
}

export interface WorkerAccrual {
  workerId: number;
  tier: WorkerTier;
  coins: number;
  hours: number;
  capped: boolean;
  accrualStart: Date;
  accrualEnd: Date;
}

const HOUR_MS = 3_600_000;

export function isWorkerTier(value: number): value is WorkerTier {
  return value === 1 || value === 2 || value === 3;
}

export function isWorkerHours(value: number): value is WorkerHours {
  return value === 1 || value === 8 || value === 24;
}

export function rentWorker(
  settings: EconomySettings,
  tier: WorkerTier,
  hours: WorkerHours,
  now: Date,
): { cost: number; startedAt: Date; endsAt: Date } {
  const cost = workerRentPrice(settings, tier, hours);
  const endsAt = new Date(now.getTime() + hours * HOUR_MS);
  return { cost, startedAt: now, endsAt };
}

/**
 * Offline accrual is server-clock only, stops at `rental_ends_at`, and is
 * capped at `worker_max_offline_hours` per collection window (PLAN §2.6,
 * §10.3). Momentum is applied at collection time.
 */
export function accrueWorker(
  settings: EconomySettings,
  worker: WorkerRecord,
  momentum: number,
  now: Date,
): WorkerAccrual {
  const tier: WorkerTier = isWorkerTier(worker.tier) ? worker.tier : 1;
  const accrualStart = worker.lastCollectedAt
    ? new Date(Math.max(worker.lastCollectedAt.getTime(), worker.rentalStartedAt.getTime()))
    : new Date(worker.rentalStartedAt.getTime());

  const capEnd = new Date(accrualStart.getTime() + settings.worker_max_offline_hours * HOUR_MS);
  const accrualEnd = new Date(Math.min(now.getTime(), worker.rentalEndsAt.getTime(), capEnd.getTime()));
  const capped = now.getTime() > capEnd.getTime() && worker.rentalEndsAt.getTime() > capEnd.getTime();

  const elapsedMs = Math.max(0, accrualEnd.getTime() - accrualStart.getTime());
  const hours = elapsedMs / HOUR_MS;
  const coins = Math.floor(hours * workerOutputPerHour(settings, tier) * Math.max(0, momentum));

  return { workerId: worker.id, tier, coins, hours, capped, accrualStart, accrualEnd };
}

export function accrueAll(
  settings: EconomySettings,
  workers: WorkerRecord[],
  momentum: number,
  now: Date,
): { total: number; rows: WorkerAccrual[] } {
  const rows = workers.map((worker) => accrueWorker(settings, worker, momentum, now));
  return { total: rows.reduce((sum, row) => sum + row.coins, 0), rows };
}

export function pendingWorkerCoins(
  settings: EconomySettings,
  workers: WorkerRecord[],
  momentum: number,
  now: Date,
): number {
  return accrueAll(settings, workers, momentum, now).total;
}

export function workerAvailableHours(
  settings: EconomySettings,
  worker: WorkerRecord,
  now: Date,
): number {
  const accrual = accrueWorker(settings, worker, 1, now);
  return Math.floor(accrual.hours * 100) / 100;
}
