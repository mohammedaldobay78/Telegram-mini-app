# Threat model — Earn Money

- **Owner:** security-agent
- **PLAN refs:** §2.12, §10
- **Last updated:** 2026-11-11

## 1. Assets

1. Coin balances (redeemable for Telegram Stars via gifts).
2. The Stars balance of the bot.
3. Telegram identity (initData) and the bot token.
4. Ledger integrity and admin audit trail.
5. Payout budget (per-user and global).

## 2. Trust boundaries

| Boundary | Trusted side | Untrusted side |
|---|---|---|
| Mini App → API | server, DB, bot token | every request body, header and timer |
| Telegram → webhook | `X-Telegram-Bot-Api-Secret-Token` | raw update JSON |
| Adsgram → postback | `ADSGRAM_SECRET` | query params and client claims |
| Admin UI → API | signed callback data + admin allowlist | browser input |
| Cron → API | `CRON_SECRET` | public internet |

## 3. Threats and controls

| Threat | Control | Code | Test |
|---|---|---|---|
| Forged identity | HMAC-SHA256 initData validation + 1 h max age + replay cache | `server/auth/init-data.ts` | `tests/unit/init-data.test.ts` |
| Balance forgery | Client never sends balance or `M`; `ledger.post()` is the only mutation | `server/economy/ledger.ts` | `tests/integration/ledger.test.ts` |
| Double credit | Nonce/charge-id/idempotency-key uniques + row locks | `ledger.ts`, `ads.ts`, `stars.ts` | ads/stars/ledger suites |
| Tap macro | Batch ceiling 50, min interval 120 ms, CV < 0.05 flag removes duration bonus | `security/anomaly.ts` | `tests/fraud/tap.test.ts` |
| Tap replay | Per-user nonce in `used_nonces` + ledger key `tap:<user>:<nonce>` | `services/tap.ts` | tap suite |
| Ad replay | One ad view per nonce, 15 min TTL, replay returns duplicate | `services/ads.ts` | ads suite |
| Ad cap / cooldown abuse | 30/day cap, 30 s cooldown, paid tickets after 10 free | `services/ads.ts` | ads suite |
| Fake Adsgram claim | Client claim returns `pendingPostback`; only the signed server postback credits | `services/ads.ts`, `ads/adsgram.ts` | ads suite |
| Stars payment replay | `telegram_payment_charge_id` unique; credit transaction | `services/stars.ts` | stars suite |
| Payment amount tampering | Currency must be `XTR` and amount must equal the pack price | `services/stars.ts` | stars suite |
| Pack arbitrage | `stars ≥ ceil(coins / 20,000 × 1.2)` at invoice and credit | `economy/pricing.ts` | pricing/stars suites |
| Redemption double-spend | Coins locked on request, one open redemption per user, idempotency key | `services/redemption.ts` | redemption suite |
| Payout budget drain | Per-user weekly/monthly caps + global 30-day ad-revenue budget | `security/gate.ts` | redemption suite |
| Gift delivery double-send | `sent` written before the Telegram call, then `delivered` or `failed` + refund; `sent` rows are never auto-retried | `services/redemption.ts`, `cron/reconcile` | payout suite |
| Admin action forgery | HMAC over `id:action:at`, 900 s expiry, admin allowlist | `telegram/sign.ts`, `http/route.ts` | access suite |
| Webhook forgery | Secret-token header comparison, `telegram_updates` idempotency | `http/route.ts`, webhook route | — (covered by route wiring) |
| Referral farming | Qualification thresholds, self-referral block, IP `/24` clustering, risk flags freeze (never auto-ban) | `services/referrals.ts`, `security/fraud.ts`, `security/ip.ts` | access suite |
| Rate-limit bypass | Per-user and per-IP fixed windows; Redis in prod, in-process fallback | `security/ratelimit.ts` | access suite |
| Admin UI secret leak | GET returns pre-signed `callbackData`; `WEBHOOK_SECRET` never leaves the server | `api/admin/redemption/route.ts` | typecheck + manual review |
| Config drift | Settings DB-backed with Zod validation and audit; no economy constants in code | `config/settings.ts` | typecheck/simulator |

## 4. Residual risks

1. **Ambiguous gift delivery.** The row is written to `sent` before the Telegram
   call, so a crash can leave a gift delivered but unreceipted (or a gift that
   never left). The queue never retries `sent` rows, which prevents double
   sends; the cost is manual reconciliation. `cron/reconcile` flags rows stuck
   in `sent` for >15 min and alerts admins, who must check the bot's gift
   history before refunding or resending.
2. **In-process Redis fallback.** If production omits `REDIS_URL`, rate limits and
   nonces are per-instance. Treat missing Redis as a launch blocker.
3. **Referral commission second transaction.** A crash can leave a commission
   unpaid; it can never be paid twice. Reconciliation should surface the gap.
4. **Telegram catalog drift.** A configured gift id can disappear. The payouts
   kill switch and `pnpm gifts:check` are the mitigation.
5. **PGlite vs production Postgres.** Integration tests do not prove production
   lock behaviour; run the suite against the preview database before launch.

## 5. Security sign-off checklist

- [x] Every §10.3 control has code and a test or a documented operational control.
- [x] No route accepts a client-supplied balance, amount earned or multiplier.
- [x] All balance mutations go through `ledger.post()`.
- [x] Secrets are read only through `lib/env.ts`.
- [x] Kill switches are settings-backed and require no deploy.
- [ ] Staging penetration pass with a real Telegram account (release-agent).
- [ ] Production Redis and Sentry confirmed (release-agent).
