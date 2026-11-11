"use client";

import { useState } from "react";
import { useAppState, useRefresh } from "@/app/providers";
import { Button, Card, Chip, ErrorNote, Modal, ProgressBar, SectionTitle } from "@/components/ui";
import { api, errorMessage, idempotencyKey } from "@/lib/client-api";
import { formatCoins, formatDuration } from "@/lib/format";
import { haptic } from "@/lib/telegram";

interface AdStart {
  nonce: string;
  provider: "mock" | "adsgram";
  free: boolean;
  ticket: boolean;
  adsRemaining: number;
  cooldownSeconds: number;
  blockId?: string;
}

interface AdClaim {
  reward: number;
  balance: number;
  duplicate: boolean;
  pendingPostback?: boolean;
}

export default function TasksPage() {
  const { data: state, error, refetch } = useAppState();
  const refresh = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [adOpen, setAdOpen] = useState(false);
  const [adText, setAdText] = useState("Preparing the ad…");

  async function checkin() {
    setBusy("checkin");
    setActionError(null);
    try {
      const result = await api<{ amount: number; streakDays: number; weeklyReward: number }>("/api/tasks/checkin", {
        method: "POST",
        body: { idempotencyKey: idempotencyKey("checkin") },
      });
      haptic("success");
      setNotice(
        `Daily gift +${formatCoins(result.amount)} · streak ${result.streakDays}${
          result.weeklyReward > 0 ? ` · weekly +${formatCoins(result.weeklyReward)}` : ""
        }`,
      );
      await refresh();
    } catch (cause) {
      haptic("error");
      setActionError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function claimQuest(questId: string) {
    setBusy(`quest:${questId}`);
    setActionError(null);
    try {
      const result = await api<{ reward: number; duplicate: boolean }>("/api/tasks/quest", {
        method: "POST",
        body: { questId, idempotencyKey: idempotencyKey(`quest:${questId}`) },
      });
      haptic("success");
      setNotice(result.duplicate ? "Quest already claimed" : `Quest reward +${formatCoins(result.reward)}`);
      await refresh();
    } catch (cause) {
      haptic("error");
      setActionError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function buyTicket() {
    setBusy("ticket");
    setActionError(null);
    try {
      await api("/api/store/purchase", {
        method: "POST",
        body: { kind: "ad_ticket", idempotencyKey: idempotencyKey("ad_ticket") },
      });
      setNotice("Ad ticket bought. Start an ad to use it.");
      await refresh();
    } catch (cause) {
      haptic("error");
      setActionError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function watchAd() {
    setBusy("ad");
    setActionError(null);
    setAdOpen(true);
    setAdText("Starting a rewarded ad…");
    try {
      const start = await api<AdStart>("/api/tasks/ad/start", {
        method: "POST",
        body: { idempotencyKey: idempotencyKey("ad_start") },
      });

      if (start.provider === "mock") {
        setAdText("Mock ad playing (3s)…");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        setAdText("Ad opened. Waiting for the network postback…");
      }

      const claim = await api<AdClaim>("/api/tasks/ad/claim", {
        method: "POST",
        body: { nonce: start.nonce, idempotencyKey: idempotencyKey("ad_claim") },
      });

      if (claim.pendingPostback) {
        setAdText("Ad watched. The reward is credited by the signed server postback.");
        setNotice("Ad recorded. Coins arrive after the network confirms.");
      } else {
        haptic("success");
        setAdText(`Reward +${formatCoins(claim.reward)} coins`);
        setNotice(`Ad reward +${formatCoins(claim.reward)} coins`);
      }
      await refresh();
    } catch (cause) {
      haptic("error");
      setActionError(errorMessage(cause));
      setAdOpen(false);
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return (
      <div className="p-6">
        {error ? <ErrorNote onRetry={() => void refetch()}>{errorMessage(error)}</ErrorNote> : <Card>Loading tasks…</Card>}
      </div>
    );
  }

  const freeAdsLeft = state.ads.freeRemaining;
  const canWatch = !state.ads.dailyCapReached && (freeAdsLeft > 0 || state.ads.tickets > 0);
  const needsTicket = freeAdsLeft === 0 && state.ads.tickets === 0;

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
      <header>
        <p className="text-xs uppercase tracking-wide text-hint">Daily loop</p>
        <h1 className="text-xl font-bold">Tasks</h1>
      </header>

      {notice ? (
        <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-2.5 text-xs text-emerald-200">
          {notice}
        </div>
      ) : null}
      {actionError ? (
        <div className="mt-3">
          <ErrorNote onRetry={() => setActionError(null)}>{actionError}</ErrorNote>
        </div>
      ) : null}

      <Card className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Daily check-in</h3>
            <p className="text-xs text-hint">
              Streak {state.streakDays} · weekly {state.weeklyCheckins}/7 check-ins
            </p>
          </div>
          <Button onClick={() => void checkin()} loading={busy === "checkin"} disabled={!state.dailyGiftAvailable}>
            {state.dailyGiftAvailable ? "Claim" : "Claimed"}
          </Button>
        </div>
        <ProgressBar className="mt-3" value={state.weeklyCheckins} max={7} />
        <p className="mt-2 text-[11px] text-hint">
          Gift tiers: 5,000 / 7,000 / 10,000 coins. Seven check-ins in a week pays the weekly chain.
        </p>
      </Card>

      <SectionTitle hint={`${state.ads.watchedToday} watched today`}>Rewarded ads</SectionTitle>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Watch an ad</h3>
            <p className="text-xs text-hint">
              {freeAdsLeft > 0
                ? `${freeAdsLeft} free left · ${state.ads.tickets} tickets`
                : `${state.ads.tickets} ticket(s) · free quota used`}
            </p>
            {state.ads.cooldownSeconds > 0 ? (
              <p className="mt-1 text-[11px] text-amber-300">Cooldown {formatDuration(state.ads.cooldownSeconds)}</p>
            ) : null}
          </div>
          <Button
            onClick={() => void watchAd()}
            loading={busy === "ad"}
            disabled={!canWatch || state.ads.cooldownSeconds > 0}
          >
            Watch
          </Button>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Chip tone="neutral">{state.ads.watchedToday}/30 daily cap</Chip>
          {needsTicket && !state.ads.dailyCapReached ? (
            <Button variant="secondary" loading={busy === "ticket"} onClick={() => void buyTicket()}>
              Buy ticket
            </Button>
          ) : null}
        </div>
        {state.ads.dailyCapReached ? (
          <p className="mt-2 text-[11px] text-hint">Daily ad cap reached. Come back at 00:00 UTC.</p>
        ) : null}
      </Card>

      <SectionTitle hint="resets 00:00 UTC">Daily quests</SectionTitle>
      <div className="flex flex-col gap-2">
        {state.quests.map((quest) => {
          const done = quest.progress >= quest.target;
          return (
            <Card key={quest.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-bold">{quest.title}</h3>
                    {quest.claimed ? <Chip tone="good">Claimed</Chip> : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <ProgressBar value={quest.progress} max={quest.target} />
                    <span className="shrink-0 text-[11px] text-hint">
                      {formatCoins(quest.progress)}/{formatCoins(quest.target)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-amber-300">+{formatCoins(quest.reward)} coins</p>
                </div>
                <Button
                  variant={done && !quest.claimed ? "primary" : "secondary"}
                  disabled={!done || quest.claimed}
                  loading={busy === `quest:${quest.id}`}
                  onClick={() => void claimQuest(quest.id)}
                >
                  {quest.claimed ? "Done" : "Claim"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal open={adOpen} onClose={() => setAdOpen(false)} title="Rewarded ad">
        <p className="text-sm text-hint">{adText}</p>
        {busy !== "ad" ? (
          <Button className="mt-4 w-full" onClick={() => setAdOpen(false)}>
            Close
          </Button>
        ) : null}
      </Modal>
    </div>
  );
}
