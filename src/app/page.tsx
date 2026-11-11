"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppState, useAuth, useRefresh } from "@/app/providers";
import { Button, Card, Chip, ErrorNote, Modal, ProgressBar, SectionTitle, Stat } from "@/components/ui";
import { api, errorMessage, idempotencyKey } from "@/lib/client-api";
import { formatCoins, formatDuration } from "@/lib/format";
import { haptic } from "@/lib/telegram";
import type { MomentumComponents } from "@/lib/types";

interface TapResponse {
  taps: number;
  reward: number;
  balance: number;
  energy: number;
  energyCap: number;
  momentum: MomentumComponents;
  flagged: boolean;
  duplicate: boolean;
  signupBonus: number;
}

interface FloatingCoin {
  id: number;
  x: number;
  amount: number;
}

export default function TapPage() {
  const { session } = useAuth();
  const { data: state, error: stateError, refetch } = useAppState();
  const refresh = useRefresh();

  const [energy, setEnergy] = useState(0);
  const [coins, setCoins] = useState(0);
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [storePrompt, setStorePrompt] = useState(false);
  const [floats, setFloats] = useState<FloatingCoin[]>([]);
  const [collecting, setCollecting] = useState(false);

  const pendingRef = useRef(0);
  const intervalsRef = useRef<number[]>([]);
  const lastTapRef = useRef(0);
  const flushingRef = useRef(false);
  const floatId = useRef(0);

  useEffect(() => {
    if (!state) return;
    if (pendingRef.current === 0) {
      setEnergy(state.energy.energy);
      setCoins(state.user.balance);
    }
  }, [state]);

  const perTap = state ? Math.max(1, Math.floor(state.tapReward * state.momentum.total)) : 10;

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    const taps = Math.min(pendingRef.current, 50);
    if (taps <= 0) return;

    pendingRef.current -= taps;
    const intervals = intervalsRef.current.splice(0, taps);
    flushingRef.current = true;
    try {
      const result = await api<TapResponse>("/api/tap", {
        method: "POST",
        body: {
          taps,
          nonce: idempotencyKey("tap"),
          clientTs: Date.now(),
          interTapMs: intervals,
        },
      });
      setEnergy(result.energy);
      setCoins(result.balance);
      if (result.signupBonus > 0) {
        setNotice(`Signup bonus: +${formatCoins(result.signupBonus)} coins`);
        haptic("success");
      }
      if (result.flagged) setNotice("Automation detected: this session's duration bonus was removed.");
    } catch (cause) {
      setActionError(errorMessage(cause));
      await refresh();
    } finally {
      flushingRef.current = false;
      setPending(pendingRef.current);
    }
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void flush();
    }, 750);
    return () => window.clearInterval(timer);
  }, [flush]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastTapRef.current > 240_000) return;
      api("/api/heartbeat", {
        method: "POST",
        body: { nonce: idempotencyKey("hb"), clientTs: Date.now(), visible: true },
      }).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function handleTap(event: React.PointerEvent<HTMLButtonElement>) {
    if (!state) return;
    if (energy <= 0) {
      haptic("error");
      setStorePrompt(true);
      return;
    }

    haptic("tap");
    const now = Date.now();
    if (lastTapRef.current > 0) {
      intervalsRef.current.push(now - lastTapRef.current);
      if (intervalsRef.current.length > 500) intervalsRef.current.shift();
    }
    lastTapRef.current = now;

    pendingRef.current += 1;
    setPending(pendingRef.current);
    setEnergy((value) => Math.max(0, value - 1));
    setCoins((value) => value + perTap);

    const id = floatId.current++;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX ? event.clientX - rect.left : rect.width / 2;
    setFloats((current) => [...current.slice(-6), { id, x, amount: perTap }]);
    window.setTimeout(() => {
      setFloats((current) => current.filter((item) => item.id !== id));
    }, 700);

    if (energy - 1 <= 0) setStorePrompt(true);
  }

  async function collect() {
    setCollecting(true);
    setActionError(null);
    try {
      const result = await api<{ collected: number; balance: number }>("/api/workers/collect", {
        method: "POST",
        body: { idempotencyKey: idempotencyKey("collect") },
      });
      setCoins(result.balance);
      haptic("success");
      setNotice(result.collected > 0 ? `Collected ${formatCoins(result.collected)} coins` : "Nothing to collect yet");
      await refresh();
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setCollecting(false);
    }
  }

  if (!state) {
    return (
      <div className="p-6">
        {stateError ? (
          <ErrorNote onRetry={() => void refetch()}>{errorMessage(stateError)}</ErrorNote>
        ) : (
          <Card>Loading your economy…</Card>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-hint">Welcome back</p>
          <h1 className="text-xl font-bold">{session?.user.firstName ?? "Player"}</h1>
        </div>
        <div className="rounded-2xl border border-white/10 bg-surface/80 px-3 py-2 text-right">
          <div className="text-[10px] uppercase tracking-wide text-hint">Balance</div>
          <div className="text-lg font-bold text-amber-300">{formatCoins(coins)}</div>
        </div>
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
        <div className="flex items-center justify-between text-xs text-hint">
          <span>
            Energy {energy}/{state.energy.cap}
          </span>
          <span>{energy >= state.energy.cap ? "Full" : `+1 in ${formatDuration(state.energy.nextRegenInSeconds)}`}</span>
        </div>
        <ProgressBar className="mt-2" value={energy} max={state.energy.cap} />
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-hint">{pending > 0 ? `${pending} taps queued` : `${formatCoins(perTap)} coins per tap`}</span>
          <Chip tone="warn">M x{state.momentum.total.toFixed(2)}</Chip>
        </div>
      </Card>

      <div className="relative mx-auto mt-6 flex h-72 w-72 items-center justify-center">
        <button
          onPointerDown={handleTap}
          className="pulse-ring relative flex h-64 w-64 select-none items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 text-3xl font-black text-amber-950 shadow-[0_20px_60px_rgba(245,158,11,0.35)] active:scale-[0.97] active:animate-coin-pop"
          aria-label="Tap to earn"
        >
          <span className="pointer-events-none flex flex-col items-center">
            <span className="text-5xl">◉</span>
            <span className="mt-1 text-lg tracking-widest">TAP</span>
            <span className="text-xs font-semibold opacity-80">+{formatCoins(perTap)}</span>
          </span>
          {floats.map((item) => (
            <span
              key={item.id}
              className="float-coin pointer-events-none absolute top-10 text-sm font-bold text-amber-100"
              style={{ left: item.x }}
            >
              +{formatCoins(item.amount)}
            </span>
          ))}
        </button>
      </div>

      <div className="mt-2 text-center text-xs text-hint">
        {state.momentum.duration > 0 ? "Duration bonus active" : "Stay 30 min today for a momentum bonus"}
      </div>

      {state.workerCoinsPending > 0 ? (
        <Card className="mt-5 border-amber-400/30 bg-amber-400/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Workers found coins</div>
              <div className="text-xs text-hint">{formatCoins(state.workerCoinsPending)} coins waiting</div>
            </div>
            <Button onClick={() => void collect()} loading={collecting}>
              Collect
            </Button>
          </div>
        </Card>
      ) : null}

      <SectionTitle hint="server-computed">Momentum</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Streak" value={`+${state.momentum.streak.toFixed(2)}`} />
        <Stat label="Duration" value={`+${state.momentum.duration.toFixed(2)}`} />
        <Stat label="Quests" value={`+${(state.momentum.dailyQuests + state.momentum.weeklyQuests).toFixed(2)}`} />
        <Stat label="Ads" value={`+${state.momentum.ads.toFixed(2)}`} />
        <Stat label="Referrals" value={`+${state.momentum.referrals.toFixed(2)}`} />
        <Stat label={state.momentum.penalty < 0 ? "Absence" : "Base"} value={`${state.momentum.penalty < 0 ? "" : "+"}${(state.momentum.penalty < 0 ? state.momentum.penalty : state.momentum.base).toFixed(2)}`} />
      </div>

      <Modal open={storePrompt} onClose={() => setStorePrompt(false)} title="Energy empty">
        <p className="text-sm text-hint">
          Energy refills one point every {state.energy.regenSeconds}s. Buy a Tap Power upgrade to earn more per tap, or
          watch a rewarded ad to keep the session going.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Link href="/store" onClick={() => setStorePrompt(false)}>
            <Button className="w-full">Open the store</Button>
          </Link>
          <Link href="/tasks" onClick={() => setStorePrompt(false)}>
            <Button variant="secondary" className="w-full">
              Watch an ad
            </Button>
          </Link>
          <Button variant="ghost" onClick={() => setStorePrompt(false)}>
            Later
          </Button>
        </div>
      </Modal>
    </div>
  );
}
