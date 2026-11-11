MILESTONE: M7
STATUS: done
DELIVERED: src/server/services/stars.ts, src/app/api/shop/coins/route.ts, src/app/api/webhook/telegram/route.ts (successful_payment), tests/integration/stars.test.ts, tests/unit/pricing.test.ts
CONTRACTS CHANGED: coin packs sold only for XTR; `telegram_payment_charge_id` is unique; invoice payload is `coins:<packId>:<userId>:<nonce>`; pack arbitrage rule `stars ≥ ceil(coins / 20,000 × 1.2)` enforced at invoice creation and at credit
TESTS: stars suite 9/9 (credit once, replay no-op, amount/currency mismatch, foreign user, malformed payload, unknown pack, arbitrage block); pricing unit suite green
FOLLOW-UPS: release-agent must confirm `BOT_TOKEN` can create invoice links and that Stars payments are enabled for the bot
RISKS: the amount and currency come from the Telegram update, never from the client. A replayed charge id returns `credited: false` with the current balance.
