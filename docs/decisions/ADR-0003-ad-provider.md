# ADR-0003 — Ads provider abstraction and server-verified postbacks

- **Status:** accepted
- **Date:** 2026-11-11
- **Owners:** telegram-agent, security-agent
- **PLAN refs:** §2.7, §8, §10.3

## Context

PLAN §8 requires Adsgram in production and a clearly labelled mock provider in
development. The client cannot be trusted to declare that an ad was watched,
and Adsgram's client callback is not sufficient proof for a coin credit.

## Decision

1. **One interface, two implementations.** `src/server/ads/provider.ts` defines
   `createNonce`, `verifyClientClaim` and `verifyServerPostback`. `mock.ts` is
   the dev provider; `adsgram.ts` is the production adapter. `AD_PROVIDER`
   selects one at runtime, never per request.
2. **The server issues the nonce.** `startAd` writes an `ad_views` row with the
   provider nonce, the free/ticket state and a 15-minute TTL. The client only
   receives the nonce.
3. **Mock claims credit once.** `claimAd` locks the user row, finds the nonce
   for that user, rejects replays and expired sessions, enforces the daily cap,
   then calls `ledger.post()` and marks the row rewarded.
4. **Adsgram claims never credit directly.** `claimAd` returns
   `pendingPostback: true`. Only `GET /api/adsgram/reward` verifies the
   provider secret and calls `creditAdsgramReward`, whose ledger key is
   `adsgram:<userId>:<nonce>`. Replays are no-ops.
5. **Cooldown, quota and kill switch are enforced on the server.** Free quota,
   paid tickets, 30 s cooldown, 30 ads/day and `flags.ads` are all checked
   before a nonce is issued or a reward is credited.

## Consequences

- A compromised client can burn ad sessions but cannot mint coins.
- Two paths exist in development (mock) and production (postback); both share
  the same caps, ledger key discipline and activity recording.
- The Adsgram postback endpoint must be configured in the Adsgram dashboard
  before launch (see `docs/ops/runbook.md`).
