"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAppState, useAuth } from "@/app/providers";
import { Button, Card, Chip, ErrorNote, SectionTitle, Stat } from "@/components/ui";
import { api, errorMessage, idempotencyKey } from "@/lib/client-api";
import { formatCoins, formatHours } from "@/lib/format";
import { haptic } from "@/lib/telegram";

interface Upgrade {
  kind: "tap_power" | "energy_cap" | "regen";
  title: string;
  level: number;
  maxLevel: number;
  maxed: boolean;
  cost: number;
  effect: string;
  paybackHours: number;
  paybackHealthy: boolean;
}

interface Consumable {
  kind: "double_tap" | "full_energy" | "auto_tap";
  title: string;
  price: number;
  durationSeconds: number;
}

interface WorkerTier {
  tier: 1 | 2 | 3;
  outputPerHour: number;
  rentPerHour: number;
  bundles: { hours: 1 | 8 | 24; price: number }[];
}

interface CoinPack {
  id: string;
  coins: number;
  stars: number;
  minimumStars: number;
  valid: boolean;
}

interface Catalog {
  upgrades: Upgrade[];
  consumables: Consumable[];
  workers: WorkerTier[];
  adTicketPrice: number;
  workerMaxOfflineHours: number;
  exchangeRate: number;
  packs: CoinPack[];
  flags: { ads: boolean; payouts: boolean; store: boolean };
}

export default function StorePage() {
  const { data: state } = useAppState();
  const { session } = useAuth();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalog = useQuery<Catalog>({
    queryKey: ["store"],
    queryFn: () => api<Catalog>("/api/store"),
    enabled: Boolean(session),
  });

  async function afterAction(message: string) {
    haptic("success");
    setNotice(message);
    await Promise.all([
      client.invalidateQueries({ queryKey: ["state"] }),
      client.invalidateQueries({ queryKey: ["store"] }),
    ]);
  }

  async function buy(kind: string, label: string) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ cost: number; balance: number; duplicate: boolean }>("/api/store/purchase", {
        method: "POST",
        body: { kind, idempotencyKey: idempotencyKey(`store:${kind}`) },
      });
      await afterAction(result.duplicate ? "Already applied" : `${label} purchased for ${formatCoins(result.cost)} coins`);
    } catch (cause) {
      haptic("error");
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function rent(tier: 1 | 2 | 3, hours: 1 | 8 | 24, price: number) {
    const key = `worker:${tier}:${hours}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await api("/api/workers/rent", {
        method: "POST",
        body: { tier, hours, idempotencyKey: idempotencyKey(key) },
      });
      await afterAction(`Worker T${tier} rented for ${hours}h (${formatCoins(price)} coins)`);
    } catch (cause) {
      haptic("error");
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-hint">The sink</p>
          <h1 className="text-xl font-bold">Store</h1>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-hint">Balance</div>
          <div className="text-lg font-bold text-amber-300">{formatCoins(state?.user.balance ?? 0)}</div>
        </div>
      </header>

      {notice ? (
        <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-2.5 text-xs text-emerald-200">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorNote onRetry={() => setError(null)}>{error}</ErrorNote>
        </div>
      ) : null}

      {catalog.error ? (
        <div className="mt-4">
          <ErrorNote onRetry={() => void catalog.refetch()}>{errorMessage(catalog.error)}</ErrorNote>
        </div>
      ) : null}

      {catalog.data && !catalog.data.flags.store ? (
        <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          The store is temporarily paused. Your coins are safe and the tap loop still works.
        </div>
      ) : null}

      <SectionTitle hint="2–6 h payback design">Permanent upgrades</SectionTitle>
      <div className="flex flex-col gap-2">
        {catalog.data?.upgrades.map((upgrade) => (
          <Card key={upgrade.kind}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold">{upgrade.title}</h3>
                  <Chip tone={upgrade.maxed ? "good" : "neutral"}>
                    Lv {upgrade.level}/{upgrade.maxLevel}
                  </Chip>
                </div>
                <p className="mt-1 text-xs text-hint">{upgrade.effect}</p>
                <p className="mt-1 text-[11px] text-hint">
                  Payback {formatHours(upgrade.paybackHours)} at reference momentum
                  {upgrade.paybackHealthy ? "" : " (outside target)"}
                </p>
              </div>
              <Button
                className="shrink-0"
                disabled={upgrade.maxed}
                loading={busy === upgrade.kind}
                onClick={() => void buy(upgrade.kind, upgrade.title)}
              >
                {upgrade.maxed ? "Max" : formatCoins(upgrade.cost)}
              </Button>
            </div>
          </Card>
        ))}
        {!catalog.data ? <Card>Loading upgrades…</Card> : null}
      </div>

      <SectionTitle hint="offline income">Workers</SectionTitle>
      <div className="flex flex-col gap-2">
        {catalog.data?.workers.map((worker) => (
          <Card key={worker.tier}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">Worker T{worker.tier}</h3>
                <p className="text-xs text-hint">
                  {formatCoins(worker.outputPerHour)} coins/h × M · rent {formatCoins(worker.rentPerHour)}/h
                </p>
              </div>
              <Chip tone="good">max {catalog.data?.workerMaxOfflineHours ?? 8} h offline</Chip>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {worker.bundles.map((bundle) => (
                <Button
                  key={bundle.hours}
                  variant="secondary"
                  loading={busy === `worker:${worker.tier}:${bundle.hours}`}
                  onClick={() => void rent(worker.tier, bundle.hours, bundle.price)}
                >
                  {bundle.hours}h · {formatCoins(bundle.price)}
                </Button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle hint="daily limits">Consumables</SectionTitle>
      <div className="flex flex-col gap-2">
        {catalog.data?.consumables.map((item) => (
          <Card key={item.kind}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">{item.title}</h3>
                <p className="text-xs text-hint">
                  {item.durationSeconds > 0 ? `${Math.round(item.durationSeconds / 60)} min buff` : "Instantly refills energy"}
                </p>
              </div>
              <Button
                variant="secondary"
                loading={busy === item.kind}
                onClick={() => void buy(item.kind, item.title)}
              >
                {formatCoins(item.price)}
              </Button>
            </div>
          </Card>
        ))}
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">Extra ad slot</h3>
              <p className="text-xs text-hint">After the free daily ads. Pays 30 coins on a verified watch.</p>
            </div>
            <Button variant="secondary" loading={busy === "ad_ticket"} onClick={() => void buy("ad_ticket", "Ad ticket")}>
              {formatCoins(catalog.data?.adTicketPrice ?? 0)}
            </Button>
          </div>
        </Card>
      </div>

      <SectionTitle hint={`1 Star = ${formatCoins(catalog.data?.exchangeRate ?? 20000)} coins`}>Coin packs</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {catalog.data?.packs.map((pack) => (
          <div key={pack.id} className="rounded-2xl border border-white/10 bg-surface/70 p-3 text-center">
            <div className="text-sm font-bold">{formatCoins(pack.coins)}</div>
            <div className="text-[11px] text-hint">coins</div>
            <div className="mt-2 text-xs font-semibold text-amber-300">{pack.stars} Stars</div>
            {!pack.valid ? <div className="mt-1 text-[10px] text-rose-300">unavailable</div> : null}
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Stat label="Worker pending" value={formatCoins(state?.workerCoinsPending ?? 0)} />
        <Stat label="Momentum" value={`x${(state?.momentum.total ?? 1).toFixed(2)}`} />
      </div>
    </div>
  );
}
