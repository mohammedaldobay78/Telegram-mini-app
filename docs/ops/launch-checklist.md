# Launch checklist — inputs and remaining gates

- **Owner:** release-agent
- **Last updated:** 2026-11-11
- **Rule:** this file never contains secret values. Values go into `.env.local`
  (gitignored) or the Vercel dashboard, never into the repository.

## 1. What must be provided

| # | Value | Where to get it | Used for | Required |
|---|---|---|---|---|
| 1 | `BOT_TOKEN` | BotFather → `/mybots` → API Token | initData HMAC, invoices, gifts, webhook | yes |
| 2 | `BOT_USERNAME` | BotFather (e.g. `earn_money_bot`) | invite links | yes |
| 3 | `ADMIN_IDS` | DM `@userinfobot`; comma-separated numeric ids | admin UI, payout DMs, reconcile alerts | yes |
| 4 | `DATABASE_URL` | Neon / Supabase / Vercel Postgres — **pooled** connection string | all persistence; migrations | yes |
| 5 | `REDIS_URL`, `REDIS_TOKEN` | Upstash Redis → REST API | rate limits + nonce store | yes |
| 6 | Public HTTPS domain | Vercel project domain | `TELEGRAM_WEBAPP_URL`, `TELEGRAM_WEBHOOK_URL`, Adsgram postback | yes |
| 7 | `ADSGRAM_BLOCK_ID` | Adsgram dashboard → your block | rewarded ads | yes for production |
| 8 | `ADSGRAM_SECRET` | Adsgram dashboard → postback secret | verifying server postbacks | yes for production |
| 9 | Gift ids ×3 | `pnpm gifts:check` with the bot token, or the Telegram gift catalog | `settings.payouts.gift_ids` (`starter`, `standard`, `premium`) | yes |
| 10 | Bot Stars balance | Fragment → buy Stars, send to the bot | gift delivery; floor is 3× `weekly_cap_stars` = 60 Stars | yes |
| 11 | `SENTRY_DSN` | Sentry project settings | error reporting | recommended |
| 12 | `VERCEL_TOKEN` **or** you run `vercel link` | Vercel account settings | deploying from this workspace | only if I deploy |

## 2. What I can generate for you

| Value | How |
|---|---|
| `WEBHOOK_SECRET` | 32 random bytes, hex — also signs admin callback data |
| `CRON_SECRET` | 32 random bytes, hex — Vercel sends it as `Authorization: Bearer …` |

Generate them locally so they never travel through chat:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rotating `WEBHOOK_SECRET` invalidates open admin approve/reject buttons; that is
safe, they expire after 900 s anyway.

## 3. Order of operations once values exist

1. Write `.env.local` locally (never commit). Fill every row of §1 that applies.
2. `pnpm db:migrate` against the production database, then `pnpm db:seed`.
3. Verify seed: `settings` must contain `economy`, `momentum`, `payouts`,
   `flags`, `security`.
4. `pnpm gifts:check` — confirm the three gift ids resolve and print the Star
   balance. Put the ids into `settings.payouts.gift_ids`.
5. Deploy, then open `/api/health`; it must return `ok: true`.
6. `pnpm webhook:set` with `TELEGRAM_WEBHOOK_URL` set.
7. BotFather: `/newapp` → set the Mini App URL; set the menu button.
8. Adsgram dashboard: postback URL `https://<domain>/api/adsgram/reward`,
   secret = `ADSGRAM_SECRET`, set `AD_PROVIDER=adsgram`.
9. Run the smoke flow (runbook §4) on a fresh Telegram account.
10. Run the kill-switch drill (runbook §5): `ads`, `payouts`, `store`.
11. Confirm the bot holds ≥ 60 Stars and that one 15-Star gift can be sent and
    shows up in the bot's gift history.
12. Tag the release and record the evidence in this file.

## 4. What I cannot do without your access

| Gate | Needs |
|---|---|
| Staging deploy | Vercel project + token, or you deploy |
| BotFather menu / Mini App | your Telegram account |
| Adsgram postback | Adsgram account |
| Real Postgres test run | `DATABASE_URL` |
| Playwright E2E | a staging URL + a test Telegram account |
| CI | a GitHub repo + push access (`gh auth` or a PAT) |

## 5. Hard blockers

- `AD_PROVIDER=mock` in production.
- Missing `REDIS_URL` / `REDIS_TOKEN` (rate limits become per-instance).
- Missing `CRON_SECRET` (cron fails closed; payouts stop).
- Empty `settings.payouts.gift_ids` (redemptions cannot resolve a gift).
- Bot Stars balance below the floor (payouts queue skips every gift).
- Any secret committed to the repository or pasted into an issue/log.
