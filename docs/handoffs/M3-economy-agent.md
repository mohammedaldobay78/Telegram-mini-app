MILESTONE: M3
STATUS: done
DELIVERED: src/server/economy/{store,workers}.ts, src/server/services/{store,workers}.ts, src/app/api/store/route.ts, src/app/api/store/purchase/route.ts, src/app/api/workers/{rent,collect}/route.ts, src/app/store/page.tsx
CONTRACTS CHANGED: upgrade costs (`base × growth^level`, ADR-0004), consumable expiry in `users.active_buffs`, worker rent bundles `1 | 8 | 24` h, 8 h offline accrual cap
TESTS: store unit suite green (payback 2–6 h, 3× base cap); worker accrual covered by service logic and simulator payback checks
FOLLOW-UPS: frontend-agent owns payback labels; economy-agent re-runs the simulator after any cost change
RISKS: worker collection is offline-only; the client must not accrue locally. Consumables are consumed from `active_buffs` on read and expire on the server clock.
