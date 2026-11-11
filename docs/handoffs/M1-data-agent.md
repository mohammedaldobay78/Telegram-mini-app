MILESTONE: M1
STATUS: done
DELIVERED: src/db/schema.ts, src/db/client.ts, src/db/seed.ts, src/db/migrations/0000_flippant_human_torch.sql, src/server/auth/init-data.ts, src/server/economy/ledger.ts, src/lib/{env,errors,schemas,types,dates}.ts, tests/unit/init-data.test.ts, tests/integration/ledger.test.ts, tests/helpers/db.ts
CONTRACTS CHANGED: `ledger.post(tx, LedgerEntryInput)` is the only balance mutation path; initData validation contract (HMAC, 1 h max age, replay cache); 16 tables and all constraints from PLAN §5 plus ADR-0002 extensions
TESTS: initData suite 6/6; ledger suite 7/7 including concurrent credits; `drizzle-kit check` clean
FOLLOW-UPS: data-agent owns future migrations; migration-reviewer must review any DDL before merge
RISKS: integration tests run on PGlite, not the production Postgres version. Re-run the suite against the preview database before launch. Ledger idempotency keys must be ≥ 8 characters.
