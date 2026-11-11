"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAppState, useAuth } from "@/app/providers";
import { Button, Card, Chip, EmptyState, ErrorNote, SectionTitle, Stat } from "@/components/ui";
import { api, errorMessage, idempotencyKey } from "@/lib/client-api";
import { formatCoins, formatDate } from "@/lib/format";
import { haptic, openInvoice } from "@/lib/telegram";

interface CoinPack {
  id: string;
  coins: number;
  stars: number;
  minimumStars: number;
  valid: boolean;
}

interface Catalog {
  packs: CoinPack[];
  exchangeRate: number;
}

interface RedemptionResult {
  id: number;
  giftId: string;
  coins: number;
  stars: number;
  status: string;
  duplicate: boolean;
}

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = {
  requested: "warn",
  approved: "warn",
  sent: "warn",
  delivered: "good",
  failed: "bad",
  refunded: "neutral",
  rejected: "bad",
};

export default function WalletPage() {
  const { session } = useAuth();
  const { data: state } = useAppState();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalog = useQuery<Catalog>({
    queryKey: ["wallet-catalog"],
    queryFn: () => api<Catalog>("/api/store"),
    enabled: Boolean(session),
  });

  const balance = state?.user.balance ?? 0;
  const exchangeRate = catalog.data?.exchangeRate ?? state?.exchangeRate ?? 20000;
  const pendingRedemption = state?.redemptions.some((row) =>
    ["requested", "approved", "sent", "failed"].includes(row.status),
  );

  async function redeem(giftId: string, title: string, coins: number) {
    setBusy(`gift:${giftId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await api<RedemptionResult>("/api/redeem", {
        method: "POST",
        body: { giftId, idempotencyKey: idempotencyKey(`redeem:${giftId}`) },
      });
      haptic("success");
      setNotice(
        result.duplicate
          ? "You already have this redemption in progress."
          : `${title} requested. ${formatCoins(coins)} coins are locked until an admin delivers it.`,
      );
      await client.invalidateQueries({ queryKey: ["state"] });
    } catch (cause) {
      haptic("error");
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function buyPack(pack: CoinPack) {
    setBusy(`pack:${pack.id}`);
    setError(null);
    setNotice(null);
    try {
      const invoice = await api<{ url: string; coins: number; stars: number }>("/api/shop/coins", {
        method: "POST",
        body: { packId: pack.id },
      });
      const status = await openInvoice(invoice.url);
      if (status === "paid") {
        haptic("success");
        setNotice("Payment received. Coins are credited as soon as Telegram confirms the charge.");
        // The webhook credits the pack; refresh shortly after.
        window.setTimeout(() => {
          void client.invalidateQueries({ queryKey: ["state"] });
        }, 3000);
      } else if (status === "cancelled") {
        setNotice("Payment cancelled. Nothing was charged.");
      } else {
        setNotice("Invoice closed. If you paid, coins will appear after confirmation.");
      }
    } catch (cause) {
      haptic("error");
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
      <header>
        <p className="text-xs uppercase tracking-wide text-hint">Value you own</p>
        <h1 className="text-xl font-bold">Wallet</h1>
      </header>

      <Card className="mt-4 bg-gradient-to-br from-amber-500/20 to-orange-600/5">
        <div className="text-[11px] uppercase tracking-wide text-hint">Coin balance</div>
        <div className="mt-1 text-3xl font-black text-amber-300">{formatCoins(balance)}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-hint">
          <Chip tone="neutral">1 Star = {formatCoins(exchangeRate)} coins</Chip>
          <Chip tone="neutral">Lifetime {formatCoins(state?.user.lifetimeCoinsEarned ?? 0)}</Chip>
        </div>
      </Card>

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

      <SectionTitle hint="admin-approved queue">Redeem for Telegram gifts</SectionTitle>
      <div className="flex flex-col gap-2">
        {(state?.gifts ?? []).map((gift) => {
          const affordable = balance >= gift.coins;
          const blocked = !gift.unlocked || !affordable || pendingRedemption;
          return (
            <Card key={gift.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold">{gift.title}</h3>
                    <Chip tone={gift.unlocked ? "good" : "neutral"}>{gift.stars} Stars</Chip>
                  </div>
                  <p className="mt-1 text-xs text-hint">{gift.note}</p>
                  <p className="mt-1 text-sm font-semibold text-amber-300">{formatCoins(gift.coins)} coins</p>
                </div>
                <Button
                  variant={gift.unlocked && affordable ? "primary" : "secondary"}
                  disabled={blocked}
                  loading={busy === `gift:${gift.id}`}
                  onClick={() => void redeem(gift.id, gift.title, gift.coins)}
                >
                  {!gift.unlocked ? "Locked" : !affordable ? "Need coins" : "Redeem"}
                </Button>
              </div>
            </Card>
          );
        })}
        {pendingRedemption ? (
          <p className="px-1 text-[11px] text-hint">
            You already have a redemption in progress. Coins stay locked until it is delivered, failed or rejected.
          </p>
        ) : null}
      </div>

      <SectionTitle hint="Telegram Stars">Buy coins</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {(catalog.data?.packs ?? []).map((pack) => (
          <button
            key={pack.id}
            disabled={!pack.valid || busy === `pack:${pack.id}`}
            onClick={() => void buyPack(pack)}
            className="rounded-2xl border border-white/10 bg-surface/70 p-3 text-center transition active:scale-[0.98] disabled:opacity-40"
          >
            <div className="text-sm font-bold">{formatCoins(pack.coins)}</div>
            <div className="text-[10px] text-hint">coins</div>
            <div className="mt-2 text-xs font-semibold text-amber-300">
              {busy === `pack:${pack.id}` ? "…" : `${pack.stars} Stars`}
            </div>
            {!pack.valid ? <div className="mt-1 text-[10px] text-rose-300">unavailable</div> : null}
          </button>
        ))}
        {!catalog.data ? <Card className="col-span-3">Loading packs…</Card> : null}
      </div>
      <p className="mt-2 px-1 text-[11px] text-hint">
        Stars are non-refundable. Coins are credited only after Telegram confirms the payment.
      </p>

      <SectionTitle hint="latest 20">Redemption history</SectionTitle>
      {!state ? (
        <Card>Loading history…</Card>
      ) : state.redemptions.length === 0 ? (
        <EmptyState>No redemptions yet. Your first starter gift is available now.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {state.redemptions.map((row) => (
            <Card key={row.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">#{row.id} · {row.giftId}</div>
                  <div className="text-[11px] text-hint">
                    {formatCoins(row.coins)} coins · {row.stars} Stars · {formatDate(row.createdAt)}
                  </div>
                  {row.error ? <div className="mt-1 text-[11px] text-rose-300">{row.error}</div> : null}
                </div>
                <Chip tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</Chip>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Gifts delivered" value={state?.redemptions.filter((row) => row.status === "delivered").length ?? 0} />
        <Stat label="In progress" value={pendingRedemption ? "1" : "0"} />
      </div>
    </div>
  );
}
