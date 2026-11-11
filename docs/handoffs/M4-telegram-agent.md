MILESTONE: M4
STATUS: done
DELIVERED: src/server/services/rewards.ts, src/server/telegram/{bot,notify,api}.ts, src/app/api/tasks/{checkin,quest}/route.ts, src/app/api/tasks/route.ts, src/app/api/webhook/telegram/route.ts, src/app/api/cron/{notify,reset}/route.ts, tests/integration/rewards.test.ts
CONTRACTS CHANGED: `/api/tasks/checkin`, `/api/tasks/quest`, `/api/tasks`; daily gift tiers 5,000/7,000/10,000; weekly chain 30,000 after 7 check-ins; notification cap = 2/user/day enforced by `notifications` unique index
TESTS: rewards suite 10/10 (streak, weekly bonus, quest idempotency, metric routing)
FOLLOW-UPS: release-agent must register the webhook with `scripts/set-webhook.ts` and set bot commands
RISKS: `notifyUser`/`notifyAdmins` swallow Telegram failures by design, so delivery failures appear only in logs. The webhook trusts only the `X-Telegram-Bot-Api-Secret-Token` header and the `WEBHOOK_SECRET` secret.
