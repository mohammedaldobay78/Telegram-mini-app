"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAppState, useAuth } from "@/app/providers";
import { Button, Card, Chip, EmptyState, ErrorNote, SectionTitle, Stat } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatCoins, formatDate } from "@/lib/format";
import { haptic, shareLink } from "@/lib/telegram";

interface Invitee {
  id: number;
  name: string;
  username: string | null;
  qualified: boolean;
  joinedAt: string;
  lifetimeCoinsEarned: number;
}

interface ReferralsResponse {
  code: string;
  inviteLink: string;
  totals: { total: number; qualified: number };
  invitees: Invitee[];
}

export default function FriendsPage() {
  const { session } = useAuth();
  const { data: state } = useAppState();
  const [copied, setCopied] = useState(false);

  const referrals = useQuery<ReferralsResponse>({
    queryKey: ["referrals"],
    queryFn: () => api<ReferralsResponse>("/api/referrals?limit=100"),
    enabled: Boolean(session),
  });

  const inviteLink = referrals.data?.inviteLink ?? state?.referrals.inviteLink ?? "";
  const code = referrals.data?.code ?? state?.referrals.code ?? "";

  async function copy() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      haptic("success");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      haptic("error");
    }
  }

  function share() {
    if (!inviteLink) return;
    haptic("select");
    shareLink(inviteLink, "Join Earn Money and start collecting coins with me.");
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
      <header>
        <p className="text-xs uppercase tracking-wide text-hint">Grow together</p>
        <h1 className="text-xl font-bold">Friends</h1>
      </header>

      <Card className="mt-4">
        <h2 className="text-sm font-bold">Your invite link</h2>
        <p className="mt-1 text-xs text-hint">
          Earn <span className="font-semibold text-amber-300">10%</span> of everything your invited friends earn, for
          life. Commissions stop at the daily cap.
        </p>
        <div className="mt-3 rounded-2xl bg-black/25 p-3">
          <div className="text-[10px] uppercase tracking-wide text-hint">Code</div>
          <div className="font-mono text-sm font-bold tracking-wider text-amber-200">{code || "—"}</div>
          <div className="mt-2 break-all text-[11px] text-hint">{inviteLink || "Open from Telegram to get your link"}</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button onClick={share} disabled={!inviteLink}>
            Share invite
          </Button>
          <Button variant="secondary" onClick={() => void copy()} disabled={!inviteLink}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </Card>

      {referrals.error ? (
        <div className="mt-3">
          <ErrorNote onRetry={() => void referrals.refetch()}>{errorMessage(referrals.error)}</ErrorNote>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat
          label="Invited"
          value={referrals.data?.totals.total ?? state?.referrals.total ?? 0}
          hint="Total friends"
        />
        <Stat
          label="Qualified"
          value={referrals.data?.totals.qualified ?? state?.referrals.qualified ?? 0}
          hint="Passed the anti-fraud checks"
        />
        <Stat label="Commission earned" value={formatCoins(state?.referrals.earnedCoins ?? 0)} hint="All time" />
        <Stat label="Daily cap left" value={formatCoins(state?.referrals.dailyCap ?? 0)} />
      </div>

      <SectionTitle hint="newest first">Your invitees</SectionTitle>
      {!referrals.data ? (
        <Card>{referrals.error ? "Could not load invitees." : "Loading friends…"}</Card>
      ) : referrals.data.invitees.length === 0 ? (
        <EmptyState>
          No friends yet. Share your link and the first qualifying friend gives your momentum a permanent boost.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {referrals.data.invitees.map((invitee) => (
            <Card key={invitee.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{invitee.name}</span>
                    {invitee.username ? (
                      <span className="truncate text-[11px] text-hint">@{invitee.username}</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[11px] text-hint">
                    Joined {formatDate(invitee.joinedAt)} · earned {formatCoins(invitee.lifetimeCoinsEarned)}
                  </div>
                </div>
                <Chip tone={invitee.qualified ? "good" : "warn"}>
                  {invitee.qualified ? "Qualified" : "Pending"}
                </Chip>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-4">
        <h3 className="text-sm font-bold">How qualification works</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-hint">
          <li>A new friend counts once they have real activity.</li>
          <li>Self-invites, duplicate devices and recycled accounts are rejected.</li>
          <li>Commission is 10% of their coin earnings, credited instantly.</li>
          <li>Each account can claim up to the referral daily cap per day.</li>
        </ul>
      </Card>
    </div>
  );
}
