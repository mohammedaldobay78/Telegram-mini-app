# ADR-0005 — Defer the weekly leaderboard from v1

- **Status:** accepted
- **Date:** 2026-11-11
- **Owners:** orchestrator
- **PLAN refs:** §2.2, §3.2, §3.3, §13 (M6)

## Context

PLAN §2.2 and §3.2–3.3 describe a weekly leaderboard with a 1,000,000-coin
pool for the top 50 players. M6's exit criteria include it. The current
economy simulator (§11.6) does not model leaderboard payouts, and the API table
in §6 has no leaderboard route.

Shipping an unmodelled weekly 1,000,000-coin source would invalidate the
persona hour bands and the 30-day margin gate that justify the payout limits.
Shipping a disabled or cosmetic leaderboard would contradict the reward table.

## Decision

Defer the weekly leaderboard until after launch (v1.1). For launch:

- Referrals, the daily/weekly check-in chain and the gift ladder ship as
  specified.
- No leaderboard pool is minted and no leaderboard endpoint is exposed.
- The wallet/friends screens do not advertise a leaderboard.

## Consequences

- M6 ships referrals only; the leaderboard is tracked as a post-launch item in
  the release runbook.
- The v1.1 leaderboard must add its pool to `settings`, model it in the
  simulator (including its effect on persona hours) and pass §11.6 before
  enabling it.
- PLAN §2.2, §3.2, §3.3 and §13 are annotated as deferred so the document does
  not promise a feature that is not live.
