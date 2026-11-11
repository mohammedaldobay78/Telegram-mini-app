MILESTONE: M5
STATUS: done
DELIVERED: src/server/ads/{provider,mock,adsgram,index}.ts, src/server/services/ads.ts, src/app/api/tasks/ad/{start,claim}/route.ts, src/app/api/adsgram/reward/route.ts, tests/fraud/ads.test.ts
CONTRACTS CHANGED: `AdProvider` interface; ads require a server nonce (15 min TTL); free quota 10/day; paid ticket 15 coins; daily cap 30; 30 s cooldown; Adsgram clients receive `pendingPostback`
TESTS: ads fraud suite 8/8 (replay, expiry, cap, cooldown, ticket, Adsgram postback, kill switch)
FOLLOW-UPS: release-agent configures the Adsgram dashboard postback URL and `ADSGRAM_SECRET`
RISKS: only the signed server postback credits an Adsgram reward. The mock provider must never be enabled in production (`AD_PROVIDER=mock` is a launch blocker).
