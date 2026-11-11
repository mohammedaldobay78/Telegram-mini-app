MILESTONE: M6
STATUS: done (leaderboard deferred by ADR-0005)
DELIVERED: src/server/services/referrals.ts, src/app/api/referrals/route.ts, src/app/friends/page.tsx, src/server/security/{fraud,ip}.ts, tests/fraud/access.test.ts
CONTRACTS CHANGED: `/api/referrals` returns code, invite link, totals and invitee rows; commission 10%, daily cap 20,000 coins, max 200 active referrals, 24 h qualification delay; risk flags freeze clusters instead of banning
TESTS: access/fraud suite 15/15 (nonce replay, rate limits, cluster flags, IP /24 + /64 normalisation, admin signatures)
FOLLOW-UPS: if the leaderboard is enabled in v1.1 it needs a settings key, simulator modelling and a §11.6 run first
RISKS: commission is posted in a second transaction after the invitee's earning to avoid deadlocks; a crash between the two leaves the commission unpaid (auditable, never double-paid). Self-referral and duplicate Telegram accounts are blocked at signup.
