"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/app/providers";
import { Button, Card, Chip, EmptyState, ErrorNote, SectionTitle, Stat } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatCoins, formatDate } from "@/lib/format";
import { haptic } from "@/lib/telegram";

interface QueueItem {
  id: number;
  userId: number;
  coins: number;
  stars: number;
  giftId: string;
  status: string;
  createdAt: string;
  firstName: string | null;
  username: string | null;
  telegramId: number;
  estRevenueMicro: number;
  riskFlags: Record<string, unknown> | null;
  actions: { approve: string; reject: string } | null;
}

interface Anomaly {
  id: number;
  userId: number | null;
  kind: string;
  score: string;
  payload: unknown;
  resolved: boolean;
  createdAt: string;
}

interface Overview {
  queue: QueueItem[];
  counts: { requested: number; approved: number; delivered: number; failed: number };
  anomalies: Anomaly[];
  flags: { ads: boolean; payouts: boolean; store: boolean };
  caps: { weekly: number; monthly: number; globalBudgetRatio: number };
  serverTime: string;
}

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = {
  requested: "warn",
  approved: "neutral",
  sent: "warn",
  delivered: "good",
  failed: "bad",
  refunded: "neutral",
  rejected: "bad",
};

export default function AdminPage() {
  const { session } = useAuth();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery<Overview>({
    queryKey: ["admin-overview"],
    queryFn: () => api<Overview>("/api/admin/redemption"),
    enabled: Boolean(session?.user.isAdmin),
    refetchInterval: 20_000,
  });

  async function decide(item: QueueItem, action: "approve" | "reject") {
    if (!item.actions) return;
    setBusy(`${item.id}:${action}`);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ id: number; status: string }>("/api/admin/redemption", {
        method: "POST",
        body: { callbackData: item.actions[action] },
      });
      haptic("success");
      setNotice(`Redemption #${result.id} ${result.status}.`);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-overview"] }),
        client.invalidateQueries({ queryKey: ["state"] }),
      ]);
    } catch (cause) {
      haptic("error");
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function toggleFlag(key: "ads" | "payouts" | "store") {
    if (!overview.data) return;
    setBusy(`flag:${key}`);
    setError(null);
    setNotice(null);
    try {
      const next = { ...overview.data.flags, [key]: !overview.data.flags[key] };
      const result = await api<{ flags: Overview["flags"] }>("/api/admin/settings", {
        method: "POST",
        body: { section: "flags", value: next },
      });
      haptic("success");
      setNotice(`${key} kill switch is now ${result.flags[key] ? "ON" : "OFF"}.`);
      await client.invalidateQueries({ queryKey: ["admin-overview"] });
    } catch (cause) {
      haptic("error");
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  if (!session?.user.isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <h1 className="text-lg font-bold">Admins only</h1>
          <p className="mt-2 text-sm text-hint">This page is restricted to configured administrators.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-hint">Control room</p>
          <h1 className="text-xl font-bold">Admin</h1>
        </div>
        <Button variant="secondary" loading={overview.isFetching} onClick={() => void overview.refetch()}>
          Refresh
        </Button>
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
      {overview.error ? (
        <div className="mt-3">
          <ErrorNote onRetry={() => void overview.refetch()}>{errorMessage(overview.error)}</ErrorNote>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Pending" value={overview.data?.counts.requested ?? 0} hint="Awaiting decision" />
        <Stat label="Approved" value={overview.data?.counts.approved ?? 0} hint="In payout queue" />
        <Stat label="Delivered" value={overview.data?.counts.delivered ?? 0} hint="All time" />
        <Stat label="Failed" value={overview.data?.counts.failed ?? 0} hint="Refunded automatically" />
      </div>

      <SectionTitle hint="instant, audited">Kill switches</SectionTitle>
      <Card>
        <div className="flex flex-col gap-3">
          {(["ads", "payouts", "store"] as const).map((key) => {
            const on = overview.data?.flags[key] ?? true;
            return (
              <div key={key} className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold capitalize">{key}</div>
                  <div className="text-[11px] text-hint">
                    {key === "payouts"
                      ? "Blocks new redemption requests and gift delivery."
                      : key === "ads"
                        ? "Pauses rewarded ads and ad tickets."
                        : "Pauses purchases; the tap loop keeps working."}
                  </div>
                </div>
                <button
                  onClick={() => void toggleFlag(key)}
                  disabled={busy === `flag:${key}`}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition ${
                    on ? "bg-emerald-500/80" : "bg-white/15"
                  }`}
                  aria-label={`Toggle ${key}`}
                >
                  <span
                    className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${
                      on ? "left-7" : "left-1"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      <SectionTitle
        hint={
          overview.data
            ? `caps ${overview.data.caps.weekly}w / ${overview.data.caps.monthly}m Stars`
            : undefined
        }
      >
        Redemption queue
      </SectionTitle>
      {!overview.data ? (
        <Card>{overview.error ? "Could not load the queue." : "Loading queue…"}</Card>
      ) : overview.data.queue.length === 0 ? (
        <EmptyState>No redemptions need attention.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {overview.data.queue.map((item) => {
            const risks = Object.keys(item.riskFlags ?? {});
            return (
              <Card key={item.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">#{item.id}</span>
                      <Chip tone={STATUS_TONE[item.status] ?? "neutral"}>{item.status}</Chip>
                      <Chip tone="neutral">{item.giftId}</Chip>
                    </div>
                    <div className="mt-1 truncate text-xs text-hint">
                      {item.firstName ?? "Unknown"} {item.username ? `(@${item.username})` : ""} · tg {item.telegramId}
                    </div>
                    <div className="mt-1 text-[11px] text-hint">
                      {formatCoins(item.coins)} coins · {item.stars} Stars · est. revenue $
                      {(item.estRevenueMicro / 1_000_000).toFixed(4)} · {formatDate(item.createdAt)}
                    </div>
                    {risks.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {risks.map((risk) => (
                          <Chip key={risk} tone="bad">
                            {risk}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {item.actions ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      loading={busy === `${item.id}:approve`}
                      onClick={() => void decide(item, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      loading={busy === `${item.id}:reject`}
                      onClick={() => void decide(item, "reject")}
                    >
                      Reject & refund
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-hint">
                    {["approved", "sent"].includes(item.status)
                      ? "Waiting for the payout cron to deliver the gift."
                      : "No action available for this status."}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <SectionTitle hint="unresolved">Anomalies</SectionTitle>
      {!overview.data || overview.data.anomalies.length === 0 ? (
        <EmptyState>No open anomalies.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {overview.data.anomalies.map((anomaly) => (
            <Card key={anomaly.id}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{anomaly.kind}</div>
                  <div className="text-[11px] text-hint">
                    user {anomaly.userId ?? "—"} · score {anomaly.score} · {formatDate(anomaly.createdAt)}
                  </div>
                </div>
                <Chip tone="bad">open</Chip>
              </div>
              <pre className="mt-2 max-h-32 overflow-auto rounded-xl bg-black/30 p-2 text-[10px] text-hint">
                {JSON.stringify(anomaly.payload, null, 2)}
              </pre>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
