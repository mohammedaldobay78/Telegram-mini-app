# Operations runbook — Earn Money

- **Owner:** release-agent
- **Companion:** PLAN §4.5, §9, §10.5, §14; AGENT.md C.9
- **Last updated:** 2026-11-11

## 1. Environment

Set these in Vercel (Production and Preview separately). Never commit values.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Hosted Postgres; use the pooled connection string for serverless. |
| `BOT_TOKEN` | yes | BotFather token. Needed for initData, invoices, gifts and Stars balance. |
| `BOT_USERNAME` | yes | Used to build invite links. |
| `WEBHOOK_SECRET` | yes | Also signs admin callback data. Rotating it invalidates open admin buttons. |
| `TELEGRAM_WEBHOOK_URL` | yes (setup) | `https://<domain>/api/webhook/telegram`. |
| `TELEGRAM_WEBAPP_URL` | yes | Mini App URL registered with BotFather. |
| `CRON_SECRET` | yes | Vercel sends it as `Authorization: Bearer …`. Missing in production = cron fails closed. |
| `ADMIN_IDS` | yes | Comma-separated Telegram ids. Also grants admin UI access. |
| `AD_PROVIDER` | yes | `adsgram` in production. **`mock` is a launch blocker.** |
| `ADSGRAM_BLOCK_ID` | yes | Adsgram block id. |
| `ADSGRAM_SECRET` | yes | Verifies the server postback. |
| `REDIS_URL`, `REDIS_TOKEN` | yes | Upstash. Without them rate limits and nonces fall back to per-instance memory. |
| `SENTRY_DSN` | recommended | Error reporting. |
| `NEXT_PUBLIC_APP_ENV` | yes | `production` / `preview` / `local`. |
| `LOG_LEVEL` | optional | Defaults to `info`. |

## 2. First deploy

1. Create the Vercel project and set every variable above.
2. Run migrations once against the production database:
   `DATABASE_URL=... pnpm db:migrate`
3. Seed settings and the demo user:
   `DATABASE_URL=... pnpm db:seed`
   Verify the `settings` table has `economy`, `momentum`, `payouts`, `flags`, `security`.
4. Deploy. Check `GET /api/health` returns `{ ok: true }` and a database ping.
5. Register the webhook and commands:
   `BOT_TOKEN=... TELEGRAM_WEBHOOK_URL=... WEBHOOK_SECRET=... pnpm webhook:set`
6. In BotFather, set the menu button to `TELEGRAM_WEBAPP_URL` and enable the Mini App.
7. Configure the Adsgram dashboard postback to
   `https://<domain>/api/adsgram/reward` with `ADSGRAM_SECRET`.
8. Verify the gift catalog and Stars balance:
   `BOT_TOKEN=... pnpm gifts:check`
   The bot must hold at least 3× `weekly_cap_stars` (60 Stars at defaults).
9. Run the smoke flow in §4.

## 3. Cron jobs

`vercel.json` registers:

| Job | Schedule | Purpose |
|---|---|---|
| `/api/cron/reset` | 00:00 UTC | expire workers, delete old updates/nonces/tickets, refresh settings cache |
| `/api/cron/reconcile` | hourly | ledger vs balance drift, anomaly scan |
| `/api/cron/payouts` | every 15 min | deliver approved gifts, refund failures |
| `/api/cron/notify` | hourly | worker-finished and streak-ending pushes (max 2/day) |

If a job fails, Vercel retries are safe: every job is idempotent. `CRON_SECRET`
must be set or production cron calls fail closed.

## 4. Smoke flow (staging bot)

1. Open the Mini App with a fresh Telegram account. Signup bonus arrives after
   the first tap.
2. Tap until energy is empty; the store prompt fires at energy 0.
3. Buy a Tap Power upgrade; balance decreases by exactly the quoted cost.
4. Rent a worker; collect after at least one hour of server time.
5. Watch one mock ad (staging may use mock) or an Adsgram ad; verify one credit
   and that a replay of the same nonce credits nothing.
6. Claim the daily gift; claim it again and confirm `CONFLICT`.
7. Request the starter gift only after the eligibility thresholds are met.
8. Approve it in the admin screen; run the payout cron; confirm `delivered`.
9. Force one failure (revoke a gift id in a staging settings row) and confirm
   the redemption becomes `failed` and the coins are refunded.

## 5. Kill-switch drill

Flags live in `settings.flags` and are toggled from the admin screen or
`POST /api/admin/settings`.

| Flag | Effect | Verify |
|---|---|---|
| `ads=false` | ad start/claim/postback return `KILL_SWITCHED` | tap a free ad → typed error, no coins |
| `payouts=false` | new redemptions and delivery stop | request button disabled; cron returns skipped |
| `store=false` | purchases pause | purchase returns `KILL_SWITCHED`; tap loop still works |

Drill monthly. Re-enable only after the incident is understood.

## 6. Payout operations

- The queue shows `requested`, `approved`, `sent`, `failed` rows.
- Approve/reject uses a server-signed `callbackData` valid for
  `security.admin_callback_max_age_seconds` (default 900 s). Reload the admin
  screen to refresh expired buttons.
- Reject and delivery failure both write `redemption_refund`; the ledger entry
  is idempotent by redemption id.
- **Crash window:** `processPayoutQueue` claims each row by writing `status = sent`
  *before* calling Telegram, then updates to `delivered` on success or
  `failed` + refund on error. If the process dies between the Telegram call and
  that update, the row stays `sent` and is **never retried automatically**, so a
  gift cannot be sent twice. `cron/reconcile` reports any row stuck in `sent`
  for more than 15 minutes and alerts admins; check the bot's gift history
  before refunding or resending manually.
- Weekly/monthly caps are enforced at request and again at approval.

## 7. Incident response

1. Freeze the affected surface with the kill switch (ads, payouts, or store).
2. Capture `x-request-id`, route, `telegram_id` and timestamps from logs.
3. If money is involved, run `cron/reconcile` and inspect that user's ledger:
   `SELECT delta, type, idempotency_key FROM transactions WHERE user_id = …`.
4. Roll back to the previous Vercel deployment if the issue is code.
5. If data is wrong, restore from the most recent verified backup (PLAN §11.4)
   and replay the missed period. Migrations are forward-only; do not attempt a
   down-migration.
6. Record the incident and the settings changed during it.

## 8. Monitoring

Alert on:

- `cron/payouts` non-200 for 2 consecutive runs
- `stars_payment_amount_mismatch` or `coin_pack_arbitrage_violation` log lines
- payout queue depth growing for > 1 hour
- bot Stars balance below 3× `weekly_cap_stars` (60 Stars at defaults)
- reconcile drift > `security.reconcile_drift_threshold`
- 5xx rate > 1% on `/api/tap` or `/api/state`

## 9. Known launch gaps

- Playwright E2E is not implemented yet (`tests/e2e` is empty). Add it before
  flipping production traffic.
- No staging deployment has been executed from this workspace.
- The weekly leaderboard is deferred (ADR-0005).
- Local tests use PGlite; run the suite once against the preview Postgres.
