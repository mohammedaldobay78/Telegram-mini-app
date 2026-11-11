MILESTONE: M8
STATUS: done
DELIVERED: src/server/services/redemption.ts, src/server/security/gate.ts, src/app/api/redeem/route.ts, src/app/api/admin/redemption/route.ts, src/app/api/admin/settings/route.ts, src/app/api/cron/payouts/route.ts, src/app/wallet/page.tsx, src/app/admin/page.tsx, tests/integration/{redemption,payout-queue}.test.ts
CONTRACTS CHANGED: redemption states `requested → approved → sent → delivered | failed → refunded`, plus `rejected`; coins lock on request and refund on reject/failure; admin actions use pre-signed `callbackData` from the GET response; eligibility includes account age, taps, ad views, revenue gate, risk flags and weekly/monthly caps; global 30-day budget gate
TESTS: redemption suite 12/12; payout queue suite 5/5 (deliver, fail+refund, Stars balance missing, insufficient Stars, kill switch)
FOLLOW-UPS: none for the crash window — `processPayoutQueue` now writes `status = sent` before the Telegram call, never retries `sent` rows, and `cron/reconcile` alerts on rows stuck in `sent` for >15 min.
RISKS: a crash leaves an ambiguous `sent` row that needs manual reconciliation against the bot's gift history; it can no longer double-send, because the queue only selects `approved` rows and `sent` rows are never retried.
