# ADR-0002 — Schema extensions beyond PLAN §5

- **Status:** accepted
- **Date:** 2026-11-11
- **Owners:** data-agent, approved by orchestrator
- **PLAN refs:** §5, §11.3

## Context

PLAN §5 defines the core data model. Implementing the loops, idempotency
requirements and admin tooling exposed a small number of missing tables and
columns. PLAN §0 requires a forward-only migration and a recorded decision for
every schema change.

## Decision

Add the following, all in migration `0000_flippant_human_torch.sql`:

| Addition | Why |
|---|---|
| `users.active_buffs` (JSONB) | Expiry state for consumables (`double_tap`, `auto_tap`). Avoids a second table for a tiny, per-user blob. |
| `users.risk_flags` (JSONB) | Referral-cluster and anti-cheat evidence; used by the payout gate. |
| `daily_activity.checked_in` | Needed for the 7-day check-in bonus and streak counting without scanning the ledger. |
| `daily_activity.purchases` | Quest metric `purchase_1`. |
| `daily_activity.workers_rented` | Quest metric `rent_worker`. |
| `telegram_updates` | Webhook idempotency by `update_id`; prevents duplicate payment/admin callbacks on retry. |
| `used_nonces` | DB-level single-use nonce backstop for taps and heartbeats (Redis is the fast path). |
| `notifications` | Per-user, per-kind, per-day unique index enforcing the 2-message/day push cap. |
| `redemptions.idempotency_key` | Client retries of `POST /api/redeem` are safe and return the same row. |
| `anomalies` | Admin review queue for macro/referral findings. |
| `admin_audit` | Immutable record of every admin action. |
| `settings` | DB-backed economy configuration (PLAN §4.4); no economy constant in code. |

All money columns remain `BIGINT`; no float is introduced in the money path.
Constraints include `users_balance_non_negative`, `users_energy_non_negative`,
uniques on nonces and charge ids, and foreign keys on every child table.

## Consequences

- The migration is forward-only. There is no rollback migration; rollback is a
  restore from backup (PLAN §11.4).
- `pnpm db:generate` is the only way to author DDL. Hand edits to generated SQL
  are rejected by `drizzle-kit check`.
- Tests apply the same migration to PGlite, so schema drift is caught in CI.
