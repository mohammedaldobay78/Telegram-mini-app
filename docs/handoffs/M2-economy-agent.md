MILESTONE: M2
STATUS: done
DELIVERED: src/server/economy/{momentum,energy,store}.ts, src/server/services/{momentum,tap}.ts, src/server/security/anomaly.ts, scripts/simulate-economy.ts, tests/unit/{momentum,energy,store}.test.ts, tests/fraud/tap.test.ts
CONTRACTS CHANGED: `computeMomentum` (deterministic, server-only); `computeEnergy` from server clock; tap batches accept a nonce + optional `interTapMs`; `M` and the momentum snapshot are stored on every ledger row
TESTS: simulator passes all personas and store paybacks; tap fraud suite 11/11; momentum/energy/store unit suites green
FOLLOW-UPS: any economy change re-runs `pnpm simulate` and needs an ADR (see ADR-0004)
RISKS: `regen_seconds` is 72 (not 60) so the 50-energy cap recharges in exactly 60 minutes. Anti-macro detection needs at least 8 intervals; shorter batches are not CV-flagged.
