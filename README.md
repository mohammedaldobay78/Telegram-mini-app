# Earn Money — Telegram Mini App

Tap, watch rewarded ads, rent offline workers and invite friends to earn
**coins**. Coins buy permanent upgrades or redeem for **Telegram gifts**.
Every payout is funded by the user's own ad revenue before it is sent.

The authoritative specification is [`PLAN.md`](./PLAN.md); the orchestration
model, ownership map and milestone gates are in [`AGENT.md`](./AGENT.md).
Read PLAN §0 and §10.2 before changing anything.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Styling | Tailwind CSS 3 with Telegram theme variables |
| Data | Postgres + Drizzle ORM (forward-only migrations) |
| Bot | grammY, webhook mode |
| Client state | TanStack Query + Zod |
| Cache / limits | Upstash Redis in production, in-process fallback for dev/tests |
| Ads | `mock` (dev) and `adsgram` (production) behind one interface |
| Tests | Vitest + PGlite (integration runs the real migrations) |

## Quick start

```bash
pnpm install
cp .env.example .env.local     # fill in the required values
pnpm db:migrate
pnpm db:seed
pnpm dev                       # http://localhost:3000
```

`BOT_TOKEN`, `DATABASE_URL` and `WEBHOOK_SECRET` are required for the API.
Without them only `/api/health` and the static shell are useful. See
[`docs/ops/runbook.md`](./docs/ops/runbook.md) for the full variable list.

## Gates

All four must pass before a merge:

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # Vitest: unit + integration + fraud
pnpm simulate    # PLAN §11.6 economy gate
pnpm db:check    # drizzle-kit check (no hand-edited DDL)
```

The simulator is a product gate, not a convenience script: it fails the build
if a persona falls outside its hours band, a margin drops below 1.5×, a store
upgrade pays back outside 2–6 h, or the maxed base rate exceeds 3× base.

## Layout

```
src/app          routes and screens only
src/server       economy, services, security, telegram, HTTP wrapper
src/lib          shared schemas, types, formatting, env
src/db           schema, client, seed, migrations
scripts          simulator, migrate, webhook and gift checks
tests            unit, integration, fraud (e2e is a launch follow-up)
docs             ADRs, milestone handoffs, runbook, threat model
```

## Money rules

- `server/economy/ledger.ts#post()` is the **only** function that mutates a
  balance. It locks the user row, requires an idempotency key for every
  non-tap entry, rejects negative balances and appends an immutable ledger row.
- The client never sends a balance, an amount earned or a multiplier. `M` is
  recomputed server-side on every request.
- No economy number is hardcoded: everything lives in the DB-backed `settings`
  table (seeded from `DEFAULT_SETTINGS`, 60 s cache, defaults when the DB is
  unreachable).
- Secrets are read only through `lib/env.ts` and never appear in logs.

## Economy snapshot

| Persona | Avg M | Coins/h | Hours to 300k | 30-day margin |
|---|---|---|---|---|
| Lazy | 0.80 | 400 | 750 | 10.00× |
| Mid active | 3.17 | 1,586 | 189 | 5.04× |
| Active | 4.17 | 2,085 | 144 | 2.30× |
| Very active | 6.07 | 3,035 | 99 | 2.47× |

Store upgrades pay back in 2–6 h at the reference momentum (3). These values
come from `docs/decisions/ADR-0004-economy-tuning.md`; any change to them
requires a new ADR and a fresh simulator run.

## Documentation

- [`docs/decisions/ADR-0001..0005`](./docs/decisions) — stack, schema
  extensions, ads postbacks, economy tuning, leaderboard deferral.
- [`docs/handoffs/M0..M9`](./docs/handoffs) — per-milestone deliverables,
  tests, follow-ups and residual risks.
- [`docs/ops/runbook.md`](./docs/ops/runbook.md) — deploy, cron, payouts,
  kill-switch drill, incident response.
- [`docs/ops/launch-checklist.md`](./docs/ops/launch-checklist.md) — required
  inputs, order of operations and hard launch blockers.
- [`docs/security/threat-model.md`](./docs/security/threat-model.md) —
  threat → control → code → test matrix.

## Launch status

M0–M8 are implemented and green. M9 is partial: staging deploy, Playwright
E2E, BotFather/webhook registration, the Adsgram postback, the kill-switch
drill and the Stars balance floor still need the release agent. The weekly
leaderboard is deferred to v1.1 (ADR-0005).
