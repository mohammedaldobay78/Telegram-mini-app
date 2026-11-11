# AGENT.md — Agent roster, ownership and subagent contracts

> Companion to `PLAN.md`. Every section of `PLAN.md` has exactly **one owning agent** and, where the section is large enough, one or more **subagents**.
> Read `PLAN.md` §0 and §10.2 before doing anything. Those rules outrank this file.

---

## §A Orchestration model

### A.1 Roles

| ⁦Layer⁩ | ⁦Who⁩ | ⁦Authority⁩ |
|---|---|---|
| ⁦Orchestrator⁩ | ⁦`orchestrator`⁩ | ⁦Owns milestone order, approves economy and schema changes, merges⁩ |
| ⁦Owner agents⁩ | ⁦8 specialist agents (below)⁩ | ⁦Own a PLAN section end-to-end and dispatch their subagents⁩ |
| ⁦Subagents⁩ | ⁦Narrow task agents⁩ | ⁦Produce one deliverable, never change scope, never touch other owners' files⁩ |

### A.2 Dependency graph

```
M0 orchestrator ─┬─> M1 data-agent ─┬─> M2 economy-agent ─┬─> M3 economy-agent
                  │                  │                     └─> M5 telegram-agent (ads)
                  │                  ├─> M4 telegram-agent
                  │                  ├─> M6 data-agent
                  │                  └─> M7 telegram-agent
                  └─> frontend-agent (shell, parallel from M0)
                                         M8 payout-agent <─ security-agent
                                              │
                                         M9 release-agent <─ qa-agent
```

Rules:

- No agent starts a milestone whose dependency is not **merged and green**.
- `frontend-agent` may work in parallel from M0 against typed mocks from `lib/types.ts`.
- `security-agent` reviews **every** PR that touches money, auth, or payouts; its review is a hard gate.
- `qa-agent` can block any merge with a failing test.

### A.3 Handoff contract

Every agent finishes by posting this block (in its final message and, if it changed interfaces, as `docs/handoffs/<milestone>-<agent>.md`):

```
MILESTONE: M2
STATUS: done | blocked | partial
DELIVERED: <file paths>
CONTRACTS CHANGED: <types / settings keys / endpoints>
TESTS: <command + result>
FOLLOW-UPS: <for which agent>
RISKS: <anything the next agent must know>
```

### A.4 Global definition of done (applies to every agent)

1. `pnpm typecheck` and `pnpm test` pass.
2. Every new endpoint/file has a Zod schema and typed error codes.
3. Every new economy number is read from `settings` — **no economy constant in code**.
4. Every balance mutation goes through `server/economy/ledger.ts#post()`.
5. No secret in code, logs, or fixtures.
6. `PLAN.md` updated if behavior diverges from the document.
7. Handoff block posted.

### A.5 Hard boundaries

- Subagents may **only** write inside the paths listed in their spec. Anything else is a blocker to escalate.
- No agent edits `PLAN.md` §2 or §5 without `orchestrator` approval (economy/schema change control, PLAN §0).
- No agent adds a dependency without `orchestrator` approval.
- No agent disables a rate limit, idempotency key, or cap "temporarily". Use the §10.5 kill-switch flags instead.

---

## §B Roster and PLAN section mapping

### B.1 Agent roster

| ⁦Agent⁩ | ⁦Mission⁩ | ⁦Owns⁩ |
|---|---|---|
| ⁦`orchestrator`⁩ | ⁦Sequencing, contracts, approvals, merge control⁩ | ⁦§0, §1, §4, §13, §15⁩ |
| ⁦`economy-agent`⁩ | ⁦The numbers and the loops that make them work⁩ | ⁦§2, §3 (model), §12⁩ |
| ⁦`data-agent`⁩ | ⁦Schema, ledger, endpoints, referrals, cron⁩ | ⁦§5, §6, §11.3⁩ |
| ⁦`telegram-agent`⁩ | ⁦Bot, WebApp, initData, Stars, gifts, ads⁩ | ⁦§7, §8⁩ |
| ⁦`payout-agent`⁩ | ⁦Redemption queue, admin approval, refunds, caps⁩ | ⁦§9⁩ |
| ⁦`frontend-agent`⁩ | ⁦All screens, theme, haptics, session UX⁩ | ⁦§3 (UI), §3.5⁩ |
| ⁦`security-agent`⁩ | ⁦Threat controls, reconciliation, kill switches, monitoring⁩ | ⁦§10, §11.1–11.5⁩ |
| ⁦`qa-agent`⁩ | ⁦Test matrix, simulator gate, fraud simulation⁩ | ⁦§11.1, §11.6⁩ |
| ⁦`release-agent`⁩ | ⁦Deploy, BotFather, cron, launch checklist⁩ | ⁦§14⁩ |

### B.2 Section → agent → subagent map

| ⁦PLAN section⁩ | ⁦Owner⁩ | ⁦Subagents⁩ |
|---|---|---|
| ⁦§0 Document control⁩ | ⁦orchestrator⁩ | ⁦`change-controller`⁩ |
| ⁦§1 Product overview⁩ | ⁦orchestrator⁩ | ⁦—⁩ |
| ⁦§2.1–2.2 currency + rewards⁩ | ⁦economy-agent⁩ | ⁦`currency-designer`⁩ |
| ⁦§2.3 Momentum⁩ | ⁦economy-agent⁩ | ⁦`momentum-engineer`⁩ |
| ⁦§2.4 Tier targets⁩ | ⁦economy-agent⁩ | ⁦`simulator-engineer`⁩ |
| ⁦§2.5 Store curve⁩ | ⁦economy-agent⁩ | ⁦`store-pricing-engineer`⁩ |
| ⁦§2.6 Workers⁩ | ⁦economy-agent⁩ | ⁦`worker-economist`⁩ |
| ⁦§2.7 Ads economy⁩ | ⁦economy-agent⁩ | ⁦`ads-economist`⁩ |
| ⁦§2.8 Referrals⁩ | ⁦economy-agent⁩ | ⁦`referral-designer`⁩ |
| ⁦§2.9–2.10 gift ladder + packs⁩ | ⁦economy-agent⁩ | ⁦`gift-pricing-analyst`⁩ |
| ⁦§2.11 Unit economics⁩ | ⁦economy-agent⁩ | ⁦`unit-economics-analyst`⁩ |
| ⁦§2.12 Invariants⁩ | ⁦security-agent⁩ | ⁦`invariant-guard`⁩ |
| ⁦§3.1–3.4 User loops⁩ | ⁦economy-agent⁩ | ⁦`loop-designer`⁩ |
| ⁦§3.5 Screens⁩ | ⁦frontend-agent⁩ | ⁦`design-system`, `tap-screen`, `store-screen`, `tasks-screen`, `friends-screen`, `wallet-screen`⁩ |
| ⁦§4.1–4.2 Stack + layout⁩ | ⁦orchestrator⁩ | ⁦`repo-scaffolder`, `ci-pipeline`⁩ |
| ⁦§4.3 Environments⁩ | ⁦orchestrator⁩ | ⁦`env-manager`⁩ |
| ⁦§4.4 Settings⁩ | ⁦economy-agent⁩ | ⁦`settings-keeper`⁩ |
| ⁦§4.5 Cron jobs⁩ | ⁦data-agent⁩ | ⁦`cron-builder`⁩ |
| ⁦§5 Data model⁩ | ⁦data-agent⁩ | ⁦`schema-migrator`, `ledger-guard`⁩ |
| ⁦§6 API surface⁩ | ⁦data-agent⁩ | ⁦`api-builder`, `idempotency-guard`⁩ |
| ⁦§7.1–7.2 WebApp + initData⁩ | ⁦telegram-agent⁩ | ⁦`webapp-bootstrapper`, `init-data-validator`⁩ |
| ⁦§7.3–7.4 Bot + deep links⁩ | ⁦telegram-agent⁩ | ⁦`bot-commands`, `deeplink-handler`⁩ |
| ⁦§7.5 Stars payments⁩ | ⁦telegram-agent⁩ | ⁦`stars-payments`⁩ |
| ⁦§7.6 Gift sending⁩ | ⁦telegram-agent⁩ | ⁦`gift-sender`⁩ |
| ⁦§8 Ads integration⁩ | ⁦telegram-agent⁩ | ⁦`adsgram-adapter`, `mock-ad-provider`⁩ |
| ⁦§9 Redemption⁩ | ⁦payout-agent⁩ | ⁦`redemption-queue`, `admin-approvals`, `refund-handler`⁩ |
| ⁦§10.1–10.4 Anti-cheat⁩ | ⁦security-agent⁩ | ⁦`anti-cheat-engineer`, `fraud-detector`⁩ |
| ⁦§10.5 Kill switches⁩ | ⁦security-agent⁩ | ⁦`kill-switch-operator`⁩ |
| ⁦§11.1 Test matrix⁩ | ⁦qa-agent⁩ | ⁦`unit-tests`, `integration-tests`, `e2e-tests`, `fraud-sim`⁩ |
| ⁦§11.2 Observability⁩ | ⁦security-agent⁩ | ⁦`observability-engineer`⁩ |
| ⁦§11.3–11.5 Migrations, backups, bug prevention⁩ | ⁦data-agent⁩ | ⁦`migration-reviewer`, `backup-operator`⁩ |
| ⁦§11.6 Simulator gate⁩ | ⁦qa-agent⁩ | ⁦`simulator-runner`⁩ |
| ⁦§12 Settings reference⁩ | ⁦economy-agent⁩ | ⁦`settings-keeper`⁩ |
| ⁦§13 Milestones⁩ | ⁦orchestrator⁩ | ⁦—⁩ |
| ⁦§14 Launch checklist⁩ | ⁦release-agent⁩ | ⁦`deployer`, `botfather-config`, `monitor-setup`⁩ |
| ⁦§15 Risks⁩ | ⁦orchestrator⁩ | ⁦`risk-reviewer`⁩ |
| ⁦§16 Glossary⁩ | ⁦orchestrator⁩ | ⁦—⁩ |

---

## §C Agent specifications

### C.1 `orchestrator`

**Mission.** Keep the build ordered, enforce change control, own the contracts between agents.

**Owns.** PLAN §0, §1, §4, §13, §15, §16.

**Deliverables.** Repo scaffold (§4.2), `docs/decisions/ADR-*.md`, milestone board in §13, merge approvals.

**Definition of done.** CI green · all M0 files exist · `.env.example` complete · every agent has a handoff block · no unreviewed economy/schema change.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`repo-scaffolder`⁩ | ⁦Create Next.js 15 + TS + Tailwind + Drizzle skeleton exactly as §4.2⁩ | ⁦repo tree, `package.json`, `tsconfig.json`⁩ |
| ⁦`ci-pipeline`⁩ | ⁦GitHub Actions: install, typecheck, test, drizzle check⁩ | ⁦`.github/workflows/ci.yml`⁩ |
| ⁦`env-manager`⁩ | ⁦`.env.example`, Zod-validated env loader, per-environment matrix⁩ | ⁦`src/lib/env.ts`, `.env.example`⁩ |
| ⁦`change-controller`⁩ | ⁦Enforce §0 rules; reject unreviewed economy/schema edits⁩ | ⁦review comments⁩ |
| ⁦`risk-reviewer`⁩ | ⁦Maintain §15 risk table before each milestone⁩ | ⁦updated PLAN §15⁩ |

**Handoff.** Publishes the milestone board; unblocks the next owner.

---

### C.2 `economy-agent`

**Mission.** Make the numbers correct, playable, and provably on-target. Nothing in §2 ships without the simulator.

**Owns.** PLAN §2 (all), §3.1–3.4, §12.

**Reads.** `PLAN.md` §1.4, §2, §11.6, §15.

**Deliverables.** `src/server/economy/{momentum,energy,store,workers,pricing}.ts`, `src/server/config/settings.ts`, `scripts/simulate-economy.ts`, `tests/unit/economy/*`.

**Definition of done.** Simulator passes all five thresholds in §11.6 · momentum is computed server-side only · upgrade payback 2–6 h verified · no economy constant outside `settings` · unit tests cover energy, momentum, pricing, pack arbitrage.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`currency-designer`⁩ | ⁦Lock §2.1–2.2, verify `coins_per_star` against real Adsgram CPM⁩ | ⁦`docs/economy/currency.md`⁩ |
| ⁦`momentum-engineer`⁩ | ⁦Implement §2.3 exactly; clamp 0.8–6.3; snapshot into ledger⁩ | ⁦`economy/momentum.ts` + tests⁩ |
| ⁦`simulator-engineer`⁩ | ⁦Build §11.6 simulator with the four personas; tune weights ±20% max⁩ | ⁦`scripts/simulate-economy.ts`⁩ |
| ⁦`store-pricing-engineer`⁩ | ⁦§2.5 curve; enforce 3× base-rate cap; payback check⁩ | ⁦`economy/store.ts` + tests⁩ |
| ⁦`worker-economist`⁩ | ⁦§2.6 accrual, offline cap, rent/output sanity⁩ | ⁦`economy/workers.ts`⁩ |
| ⁦`ads-economist`⁩ | ⁦§2.7 ticket price, daily caps, net-positive check⁩ | ⁦`docs/economy/ads.md`⁩ |
| ⁦`referral-designer`⁩ | ⁦§2.8 rates, qualification, caps⁩ | ⁦`docs/economy/referrals.md`⁩ |
| ⁦`gift-pricing-analyst`⁩ | ⁦§2.9–2.10 ladder and pack arbitrage rule⁩ | ⁦`economy/pricing.ts`⁩ |
| ⁦`unit-economics-analyst`⁩ | ⁦§2.11 margin table, re-run monthly after launch⁩ | ⁦`docs/economy/margins.md`⁩ |
| ⁦`loop-designer`⁩ | ⁦§3.1–3.4 loops and trigger timing⁩ | ⁦`docs/product/loops.md`⁩ |
| ⁦`settings-keeper`⁩ | ⁦§12 schema, defaults, validation, hot reload⁩ | ⁦`config/settings.ts`, seed⁩ |

**Handoff.** Publishes final `settings` keys; `data-agent` and `frontend-agent` consume them.

---

### C.3 `data-agent`

**Mission.** Own the schema, the ledger, the API surface and cron. This is where "money cannot be forged" is implemented.

**Owns.** PLAN §5, §6, §4.5, §11.3–11.5.

**Deliverables.** `src/db/{schema.ts,client.ts,migrations/,seed.ts}`, `src/server/economy/ledger.ts`, all `src/app/api/*` route handlers except Telegram/ads/payout-specific ones, `src/lib/schemas.ts`, cron routes.

**Definition of done.** Ledger invariants pass under concurrency · every mutation has an idempotency key · unique indexes on nonces/charge ids · forward-only migration reviewed by `migration-reviewer` · `pnpm drizzle-kit check` clean.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`schema-migrator`⁩ | ⁦§5 DDL → Drizzle schema + migration; constraints and indexes⁩ | ⁦`db/schema.ts`, `db/migrations/*`⁩ |
| ⁦`ledger-guard`⁩ | ⁦`post()` with row lock, idempotency, invariants; concurrency tests⁩ | ⁦`economy/ledger.ts`, tests⁩ |
| ⁦`api-builder`⁩ | ⁦§6 routes, Zod validation, typed errors, rate limits⁩ | ⁦`app/api/**`⁩ |
| ⁦`idempotency-guard`⁩ | ⁦Audit every mutating route for key + replay safety⁩ | ⁦`docs/security/idempotency.md`⁩ |
| ⁦`cron-builder`⁩ | ⁦§4.5 reset/reconcile/payouts/notify jobs⁩ | ⁦`app/api/cron/**`⁩ |
| ⁦`migration-reviewer`⁩ | ⁦Review migrations for locks, backfills, rollback plan⁩ | ⁦review notes⁩ |
| ⁦`backup-operator`⁩ | ⁦§11.4 backup + restore drill procedure⁩ | ⁦`docs/ops/backup.md`⁩ |

**Handoff.** Publishes the endpoint table and the `post()` signature to all other agents.

---

### C.4 `telegram-agent`

**Mission.** Make the Telegram surface trustworthy: identity, bot, payments, gifts, ads.

**Owns.** PLAN §7, §8.

**Deliverables.** `src/server/auth/init-data.ts`, `src/server/telegram/{bot,notify,gifts}.ts`, `src/server/ads/{provider,mock,adsgram}.ts`, `app/api/webhook/telegram/route.ts`, `app/api/adsgram/reward/route.ts`, `scripts/set-webhook.ts`, `scripts/check-gifts.ts`.

**Definition of done.** initData tests include tampered hash, stale `auth_date`, missing fields · webhook rejects wrong secret · `pre_checkout_query` answered < 10 s · payment credit idempotent · `sendGift` failure path returns a typed error · ads nonce single-use.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`webapp-bootstrapper`⁩ | ⁦§7.1 SDK init, theme, safe area, `start_param` capture⁩ | ⁦`app/layout.tsx`, `lib/telegram.ts`⁩ |
| ⁦`init-data-validator`⁩ | ⁦§7.2 HMAC validation + cache + tests⁩ | ⁦`auth/init-data.ts`⁩ |
| ⁦`bot-commands`⁩ | ⁦§7.3 commands, menu button, admin allowlist⁩ | ⁦`telegram/bot.ts`⁩ |
| ⁦`deeplink-handler`⁩ | ⁦§7.4 `startapp` parsing, referral row creation⁩ | ⁦`api/auth/telegram`⁩ |
| ⁦`stars-payments`⁩ | ⁦§7.5 invoice, webhook, idempotent credit⁩ | ⁦`api/shop/coins`, webhook⁩ |
| ⁦`gift-sender`⁩ | ⁦§7.6 catalog cache, `sendGift`, error mapping⁩ | ⁦`telegram/gifts.ts`⁩ |
| ⁦`adsgram-adapter`⁩ | ⁦§8 provider impl + postback endpoint⁩ | ⁦`ads/adsgram.ts`⁩ |
| ⁦`mock-ad-provider`⁩ | ⁦§8 dev provider, labelled in UI, disabled in prod⁩ | ⁦`ads/mock.ts`⁩ |

**Handoff.** Publishes the `AdProvider` interface and the gift catalog accessor to `payout-agent`.

---

### C.5 `payout-agent`

**Mission.** Pay out only what is earned, funded, approved and capped — with a clean refund path.

**Owns.** PLAN §9.

**Deliverables.** `app/api/redeem/route.ts`, `app/api/admin/redemption/route.ts`, `app/api/cron/payouts/route.ts`, `docs/ops/redemption.md`.

**Definition of done.** Every state in §9.1 reachable and tested · lock/unlock ledger entries balanced · failed delivery auto-refunds · caps enforced before and after approval · admin actions audited · kill switch honored.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`redemption-queue`⁩ | ⁦§9.1–9.2 state machine, coin lock, eligibility checks⁩ | ⁦`api/redeem`⁩ |
| ⁦`admin-approvals`⁩ | ⁦§9.3 DM with signed buttons, approve/reject, audit⁩ | ⁦`api/admin/redemption`⁩ |
| ⁦`refund-handler`⁩ | ⁦§9.4 failure → refund, notify, alert⁩ | ⁦`telegram/notify.ts` hook⁩ |

**Handoff.** Reports the operational runbook to `release-agent`.

---

### C.6 `frontend-agent`

**Mission.** Convert the economy into a session that feels good and never lies about money.

**Owns.** PLAN §3.5, §3 UI.

**Deliverables.** `src/app/{page,store,tasks,friends,wallet,admin}`, `src/components/**`, `src/lib/{format.ts,telegram.ts}`.

**Definition of done.** Energy-empty store prompt (§3.1) implemented as an event · TG theme vars + safe areas on all screens · haptics on tap/claim/purchase only · optimistic tap UI reconciled with server state · no client-side balance authority · Lighthouse mobile ≥ 90.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`design-system`⁩ | ⁦Theme tokens, buttons, cards, modals, haptics wrapper⁩ | ⁦`components/ui/**`⁩ |
| ⁦`tap-screen`⁩ | ⁦Main screen: coin, energy bar, tap loop, store prompt⁩ | ⁦`app/page.tsx`⁩ |
| ⁦`store-screen`⁩ | ⁦Upgrades, workers, consumables, payback labels⁩ | ⁦`app/store/**`⁩ |
| ⁦`tasks-screen`⁩ | ⁦Daily quests, ad button, cooldown and ticket states⁩ | ⁦`app/tasks/**`⁩ |
| ⁦`friends-screen`⁩ | ⁦Invite link, referral list, qualification status⁩ | ⁦`app/friends/**`⁩ |
| ⁦`wallet-screen`⁩ | ⁦Balance, gift ladder, progress bars, history, redemption form⁩ | ⁦`app/wallet/**`⁩ |
| ⁦`admin-screen`⁩ | ⁦Hidden unless `is_admin`; queue, caps, kill switches⁩ | ⁦`app/admin/**`⁩ |

**Handoff.** Publishes component APIs; `qa-agent` writes E2E against them.

---

### C.7 `security-agent`

**Mission.** Assume every client is hostile. Own the controls, the reconciliation, and the alarms.

**Owns.** PLAN §10, §11.2, §2.12.

**Deliverables.** `src/server/security/{ratelimit,nonce,anomaly,gate}.ts`, `app/api/cron/reconcile/route.ts`, `docs/security/threat-model.md`.

**Definition of done.** Every row in §10.3 has an implemented control and a test · reconciliation cron detects injected drift within one run · kill switches work without a deploy · no route accepts a client-supplied balance or multiplier.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`anti-cheat-engineer`⁩ | ⁦Tap/macro/heartbeat controls, CV detection, daily caps⁩ | ⁦`security/anomaly.ts`⁩ |
| ⁦`fraud-detector`⁩ | ⁦Referral clustering, risk flags, clawback plan⁩ | ⁦`security/fraud.ts`⁩ |
| ⁦`invariant-guard`⁩ | ⁦§2.12 invariants as DB checks + cron assertions⁩ | ⁦`cron/reconcile`⁩ |
| ⁦`kill-switch-operator`⁩ | ⁦§10.5 flags, graceful degradation tests⁩ | ⁦`config/flags.ts`⁩ |
| ⁦`observability-engineer`⁩ | ⁦Sentry, structured logs, payout-ratio alert⁩ | ⁦`lib/logger.ts`⁩ |

**Handoff.** Issues the security sign-off required for M9.

---

### C.8 `qa-agent`

**Mission.** Prove it, don't assume it.

**Owns.** PLAN §11.1, §11.6.

**Deliverables.** `tests/unit/**`, `tests/integration/**`, `tests/e2e/**`, `tests/fraud/**`, CI gate config.

**Definition of done.** Coverage of every §10.3 control · simulator thresholds green · fraud sim reproduces at least replay, burst-tap, 24/7-heartbeat, referral farm, double-charge · E2E passes against the staging bot.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`unit-tests`⁩ | ⁦Energy, momentum, pricing, gate math⁩ | ⁦`tests/unit/**`⁩ |
| ⁦`integration-tests`⁩ | ⁦Ledger concurrency, idempotency, refunds⁩ | ⁦`tests/integration/**`⁩ |
| ⁦`e2e-tests`⁩ | ⁦Playwright + staging bot flows⁩ | ⁦`tests/e2e/**`⁩ |
| ⁦`simulator-runner`⁩ | ⁦Run §11.6 in CI, publish hours table⁩ | ⁦CI artifact⁩ |
| ⁦`fraud-sim`⁩ | ⁦Attack scripts; assert reject/flag⁩ | ⁦`tests/fraud/**`⁩ |

**Handoff.** Signs the quality gate for M9.

---

### C.9 `release-agent`

**Mission.** Ship it once, correctly, with a rollback that works.

**Owns.** PLAN §14.

**Deliverables.** Vercel project config, cron registration, BotFather setup notes, `docs/ops/runbook.md`, monitoring dashboards.

**Definition of done.** Every checklist item in §14 checked with evidence · rollback tested · kill-switch drill recorded · on-call runbook exists.

**Subagents.**

| ⁦Subagent⁩ | ⁦Task⁩ | ⁦Output⁩ |
|---|---|---|
| ⁦`deployer`⁩ | ⁦Vercel envs, domains, cron, preview/prod split⁩ | ⁦deployment logs⁩ |
| ⁦`botfather-config`⁩ | ⁦`/newapp`, menu button, webhook secret, commands⁩ | ⁦`docs/ops/botfather.md`⁩ |
| ⁦`monitor-setup`⁩ | ⁦Sentry projects, alerts, payout-ratio dashboard⁩ | ⁦`docs/ops/monitoring.md`⁩ |

---

## §D Work order and gates

| ⁦Gate⁩ | ⁦Milestone⁩ | ⁦Lead⁩ | ⁦Must review⁩ | ⁦Blocks⁩ |
|---|---|---|---|---|
| ⁦G0⁩ | ⁦M0 scaffold⁩ | ⁦orchestrator⁩ | ⁦—⁩ | ⁦everything⁩ |
| ⁦G1⁩ | ⁦M1 schema/auth/ledger⁩ | ⁦data-agent⁩ | ⁦security-agent⁩ | ⁦M2–M8⁩ |
| ⁦G2⁩ | ⁦M2 tap/momentum/simulator⁩ | ⁦economy-agent⁩ | ⁦qa-agent⁩ | ⁦M3⁩ |
| ⁦G3⁩ | ⁦M3 store/workers⁩ | ⁦economy-agent⁩ | ⁦qa-agent⁩ | ⁦M4⁩ |
| ⁦G4⁩ | ⁦M4 daily loop/bot⁩ | ⁦telegram-agent⁩ | ⁦security-agent⁩ | ⁦M5⁩ |
| ⁦G5⁩ | ⁦M5 ads⁩ | ⁦telegram-agent⁩ | ⁦qa-agent⁩ | ⁦M7⁩ |
| ⁦G6⁩ | ⁦M6 referrals/leaderboard⁩ | ⁦data-agent⁩ | ⁦security-agent⁩ | ⁦M9⁩ |
| ⁦G7⁩ | ⁦M7 Stars purchases⁩ | ⁦telegram-agent⁩ | ⁦security-agent⁩ | ⁦M8⁩ |
| ⁦G8⁩ | ⁦M8 redemption/admin⁩ | ⁦payout-agent⁩ | ⁦security-agent + qa-agent⁩ | ⁦M9⁩ |
| ⁦G9⁩ | ⁦M9 hardening/launch⁩ | ⁦release-agent⁩ | ⁦orchestrator⁩ | ⁦launch⁩ |

Frontend runs in parallel from G0 and must satisfy its Definition of Done before G9.

---

## §E Cross-cutting rules (repeat to every subagent)

1. **The client is hostile.** Never accept coins, balances, multipliers, timers, or "amount earned" from a request body.
2. **One money path.** `ledger.post()` or nothing. No `UPDATE users SET balance`.
3. **Idempotency everywhere.** Every mutating endpoint, every webhook, every cron retry.
4. **Settings, not constants.** Economy numbers come from the `settings` table.
5. **No silent failure.** Payouts that cannot proceed must alert the admin and leave the user in a defined state.
6. **Kill switches, not code edits,** when production misbehaves.
7. **Cite PLAN sections** in PR descriptions and commit messages (e.g. `feat(momentum): implement §2.3`).
8. **Never widen scope.** If a task needs a change outside your owned paths, stop and escalate to the owning agent via the handoff block.

---

## §F Conflict and escalation

| ⁦Situation⁩ | ⁦Resolution⁩ |
|---|---|
| ⁦Two agents disagree on a contract⁩ | ⁦`orchestrator` decides; decision recorded as ADR⁩ |
| ⁦Tests pass but behavior violates PLAN⁩ | ⁦PLAN wins; open a plan-change request⁩ |
| ⁦Economy target unachievable within ±20%⁩ | ⁦`economy-agent` escalates to `orchestrator` with simulator output; plan revision required⁩ |
| ⁦Security review blocks a merge⁩ | ⁦Merge is blocked until fixed or an explicit, audited exception is recorded⁩ |
| ⁦Subagent touches files outside its scope⁩ | ⁦Owner reverts the change and reissues the task with tighter paths⁩ |

---

## §G Spawn prompt template

Use this when dispatching any subagent:

```
You are <subagent-name>, reporting to <owner-agent>.
Read: PLAN.md §<sections>, AGENT.md §C.<owner>, §E.
Own only these paths: <paths>.
Task: <single deliverable, one sentence>.
Acceptance: <2–4 binary checks>.
Do not: modify other paths, add dependencies, change economy numbers, disable limits.
Finish with the handoff block from AGENT.md §A.3, including STATUS, DELIVERED, TESTS, FOLLOW-UPS.
```

---

## §H Current status

| ⁦Milestone⁩ | ⁦Status⁩ |
|---|---|
| ⁦M0 Scaffold⁩ | ⁦done⁩ |
| ⁦M1 Schema/auth/ledger⁩ | ⁦done⁩ |
| ⁦M2 Tap/momentum/simulator⁩ | ⁦done⁩ |
| ⁦M3 Store/workers⁩ | ⁦done⁩ |
| ⁦M4 Daily loop/bot⁩ | ⁦done⁩ |
| ⁦M5 Ads⁩ | ⁦done⁩ |
| ⁦M6 Referrals/leaderboard⁩ | ⁦done (leaderboard deferred, ADR-0005)⁩ |
| ⁦M7 Stars purchases⁩ | ⁦done⁩ |
| ⁦M8 Redemption/admin⁩ | ⁦done⁩ |
| ⁦M9 Hardening/launch⁩ | ⁦partial⁩ |

### H.1 Status notes (2026-11-11)

- **M0-M8 implemented and green.** `tsc --noEmit` clean, Vitest 106/106, `pnpm simulate` passes PLAN §11.6, `drizzle-kit check` clean. Per-milestone handoff blocks live in `docs/handoffs/`.
- **M6 ships referrals only.** The weekly leaderboard is deferred to v1.1 (ADR-0005); no pool is minted in v1.
- **M9 is partial.** Remaining release gates, all owned by `release-agent`:
  1. Deploy to Vercel staging and run the smoke flow in `docs/ops/runbook.md` §4.
  2. Add Playwright E2E under `tests/e2e/` and run it against staging.
  3. Configure the BotFather menu button and register the webhook (`scripts/set-webhook.ts`).
  4. Set `AD_PROVIDER=adsgram` and the Adsgram postback URL/secret; `mock` is a launch blocker.
  5. Run the kill-switch drill (`docs/ops/runbook.md` §5) and verify the bot Stars balance floor.
  6. Run the suite once against the preview Postgres; PGlite does not prove production lock behaviour.
- **No git repository.** CI (`.github/workflows/ci.yml`) has never run remotely; initialise the repo and push before relying on it.