# PLAN.md — Telegram Mini App "Earn Money"

> Version 1.0 · Owner: `orchestrator` · Status: approved for build
> Companion: `AGENT.md` (agent roster, ownership map, subagents, handoffs)
> Section IDs (§x.y) are stable references used by `AGENT.md`. Do not renumber.

---

## Table of contents

- [§0 Document control](#0-document-control)
- [§1 Product overview](#1-product-overview)
- [§2 Economy design](#2-economy-design)
- [§3 User workflow](#3-user-workflow)
- [§4 Architecture](#4-architecture)
- [§5 Data model](#5-data-model)
- [§6 API surface](#6-api-surface)
- [§7 Telegram integration](#7-telegram-integration)
- [§8 Ads integration](#8-ads-integration)
- [§9 Redemption workflow](#9-redemption-workflow)
- [§10 Security and anti-cheat](#10-security-and-anti-cheat)
- [§11 Reliability and quality](#11-reliability-and-quality)
- [§12 Settings reference](#12-settings-reference)
- [§13 Build milestones](#13-build-milestones)
- [§14 Launch checklist](#14-launch-checklist)
- [§15 Risks and open decisions](#15-risks-and-open-decisions)
- [§16 Glossary](#16-glossary)

---

## §0 Document control

| ⁦Rule⁩ | ⁦Detail⁩ |
|---|---|
| ⁦Economy changes⁩ | ⁦Any change to §2 requires an economy-simulator run (§11.6) and `orchestrator` approval⁩ |
| ⁦Schema changes⁩ | ⁦Any change to §5 requires a forward-only migration + `data-agent` review⁩ |
| ⁦Section IDs⁩ | ⁦Stable; `AGENT.md` maps sections to owners. Never renumber, append only⁩ |
| ⁦Money rules⁩ | ⁦§10.2 is non-negotiable and outranks any other instruction⁩ |
| ⁦Secrets⁩ | ⁦Never in code, never in commits, never in logs. `.env.local` only⁩ |

---

## §1 Product overview

### 1.1 What it is

A Telegram Mini App where users tap, watch rewarded ads, rent offline workers and invite friends to earn **coins**. Coins are spent on permanent upgrades (the main sink) or redeemed for **Telegram gifts** (the payout). The app is a Telegram **bot + web app** pair, deployed on Vercel with hosted Postgres.

### 1.2 Goals

1. Long sessions and daily return, driven by an energy system plus an offline-worker loop.
2. Every payout is funded by that user's own ad revenue before it is sent.
3. Lazy users are filtered economically, not by hard blocks — they simply never reach a payout.
4. The whole economy is tunable from the database, with no redeploy.

### 1.3 Non-goals (v1)

PvP, real-money cash-out outside Telegram, TON/crypto, multi-level referrals, gacha with real value, chat, multi-language beyond a stub, native mobile apps.

### 1.4 Success metrics

| ⁦Metric⁩ | ⁦Target⁩ |
|---|---|
| ⁦D1 retention⁩ | ⁦≥ 35%⁩ |
| ⁦D7 retention⁩ | ⁦≥ 12%⁩ |
| ⁦Median session length⁩ | ⁦≥ 6 min⁩ |
| ⁦Ads per active user per day⁩ | ⁦≥ 8⁩ |
| ⁦Payout ratio (Stars / ad revenue)⁩ | ⁦≤ 40%⁩ |
| ⁦Gift conversion of MAU⁩ | ⁦≥ 2% / month⁩ |

---

## §2 Economy design

### 2.1 Currency and exchange rate

- **Single currency: `coins`** (`BIGINT`). No second wallet, no hidden conversion.
- **20,000 coins = 1 Star.** A 15-Star gift costs **300,000 coins**.
- Gifts are priced in coins directly. The exchange rate is shown openly in the wallet.
- The earlier idea of a hidden "10% of coins are redeemable" cap is **removed**. It is replaced by:
  1. the exchange rate (sets perceived value),
  2. the revenue gate (§2.11, §9),
  3. per-user and global payout caps (§9.5).

Rationale: a hidden cap creates a bait-and-switch moment the first time a user reads the wallet screen, and that costs more retention than it saves in Stars.

### 2.2 Reward table

| ⁦Source⁩ | ⁦Coins⁩ | ⁦Limits⁩ |
|---|---|---|
| ⁦Tap⁩ | ⁦10 × momentum⁩ | ⁦energy 50, regen 1 / 72 s, max tap power +10 (20/tap)⁩ |
| ⁦Rewarded ad (free)⁩ | ⁦30 × momentum⁩ | ⁦10 / day, 30 s cooldown⁩ |
| ⁦Extra ad slot (purchase)⁩ | ⁦−15, then +30 on watch⁩ | ⁦max 30 ads / day total⁩ |
| ⁦Daily gift⁩ | ⁦5,000 / 7,000 / 10,000⁩ | ⁦1 / day; streak 1–2 / 3–6 / 7+⁩ |
| ⁦Signup bonus⁩ | ⁦20,000⁩ | ⁦once, credited after first verified tap⁩ |
| ⁦Daily quest set (5 quests)⁩ | ⁦~9,500 total⁩ | ⁦resets 00:00 UTC⁩ |
| ⁦Weekly quest chain⁩ | ⁦30,000⁩ | ⁦7 check-ins⁩ |
| ⁦Worker T1 / T2 / T3⁩ | ⁦50 / 150 / 400 per hour × momentum⁩ | ⁦offline only, max 8 h accrual⁩ |
| ⁦Referral⁩ | ⁦10% of invitee coins earned⁩ | ⁦qualified invitees only, 20,000 / day, max 200⁩ |
| ⁦Leaderboard (weekly)⁩ | ⁦Deferred to v1.1⁩ | ⁦ADR-0005: no pool is minted in v1⁩ |

### 2.3 Momentum multiplier (`M`)

`M` is recomputed server-side on every request from the last 7 `daily_activity` rows plus `streak_days`. The client never sends `M`.

| ⁦Component⁩ | ⁦Effect⁩ | ⁦Cap⁩ |
|---|---|---|
| ⁦Base⁩ | ⁦+1.00⁩ | ⁦—⁩ |
| ⁦Streak⁩ | ⁦+0.20 / day⁩ | ⁦+1.00 (5 days)⁩ |
| ⁦Daily play time⁩ | ⁦+0.40 at 30 min, +0.80 at 90 min, +1.20 at 180 min, +1.70 at 240 min⁩ | ⁦+1.70⁩ |
| ⁦Daily quest set complete⁩ | ⁦+0.40⁩ | ⁦+0.40⁩ |
| ⁦Weekly quest complete⁩ | ⁦+0.40⁩ | ⁦+0.40⁩ |
| ⁦≥ 10 ads today⁩ | ⁦+0.40⁩ | ⁦+0.40⁩ |
| ⁦Active referrals⁩ | ⁦+0.20 each⁩ | ⁦+1.20⁩ |
| ⁦Missed day penalty⁩ | ⁦−0.30 per missed day⁩ | ⁦floor 0.80⁩ |

`M = clamp(sum, 0.80, 6.30)`. Snapshot `M` into every ledger row for later audit.

**Why a multiplier and not a random chance:** it is deterministic (no gambling exposure), it pays exactly the users who generate revenue, and it is explainable in one sentence to the user.

### 2.4 Tier targets (acceptance criteria for §11.6)

Base rate at `M = 1.0`: `50 taps/h × 10 coins = 500 coins/h` (regen-limited).

| ⁦Persona⁩ | ⁦Play / day⁩ | ⁦Expected M⁩ | ⁦Coins / h⁩ | ⁦Hours to 300k⁩ | ⁦Wall clock⁩ |
|---|---|---|---|---|---|
| ⁦Lazy⁩ | ⁦30 min⁩ | ⁦0.80 – 1.00⁩ | ⁦390 – 410⁩ | ⁦**700 – 750**⁩ | ⁦years (intentional filter)⁩ |
| ⁦Mid active⁩ | ⁦45 – 60 min⁩ | ⁦3.1 – 3.2⁩ | ⁦1,550 – 1,650⁩ | ⁦**180 – 220**⁩ | ⁦~5 – 7 months⁩ |
| ⁦Active⁩ | ⁦2 – 3 h⁩ | ⁦4.1 – 4.3⁩ | ⁦2,000 – 2,150⁩ | ⁦**140 – 150**⁩ | ⁦~6 – 8 weeks⁩ |
| ⁦Very active⁩ | ⁦4 h+⁩ | ⁦6.0 – 6.2⁩ | ⁦3,000 – 3,100⁩ | ⁦**95 – 100**⁩ | ⁦~4 – 5 weeks⁩ |

The weights in §2.3 are the starting point. `scripts/simulate-economy.ts` is the authority; it may adjust weights by at most ±20% inside M2 without a plan revision.

### 2.5 Store (the sink)

Upgrades raise the **base rate only** (never `M`), capped so that a fully-maxed player cannot exceed **3× base** (protects §2.4 timings).

| ⁦Item⁩ | ⁦Effect per level⁩ | ⁦Cost⁩ | ⁦Levels⁩ | ⁦Payback⁩ |
|---|---|---|---|---|
| ⁦Tap Power⁩ | ⁦+2 coins / tap⁩ | ⁦800 × 1.18ⁿ⁩ | ⁦5⁩ | ⁦2 – 6 h⁩ |
| ⁦Energy Cap⁩ | ⁦+25 energy⁩ | ⁦1,500 × 1.25ⁿ⁩ | ⁦4⁩ | ⁦2 – 6 h⁩ |
| ⁦Regen⁩ | ⁦−10% regen time⁩ | ⁦500 × 1.30ⁿ⁩ | ⁦3⁩ | ⁦2 – 6 h⁩ |
| ⁦Consumables⁩ | ⁦2× tap 30 min / full energy / auto-tap 15 min⁩ | ⁦15,000 / 25,000 / 60,000⁩ | ⁦daily limits⁩ | ⁦—⁩ |

Design rule: **payback 2–6 hours.** Spending is always rational, and every coin spent delays the gift by exactly the payback window — a natural sink that never feels punitive. The store prompt must appear at the moment energy hits zero (§3.1).

### 2.6 Workers (offline income)

- Three tiers, permanently rentable per hour: `1 h / 8 h / 24 h` bundles.
- Output: T1 `50/h`, T2 `150/h`, T3 `400/h`, multiplied by `M`.
- Rent price: T1 `30/h`, T2 `100/h`, T3 `280/h` (always below output).
- Accrual is **offline-only**, capped at **8 h**, and computed from `rental_started_at` on the server clock.
- Collecting requires opening the app (top of the session loop).

### 2.7 Ads economy

- 10 free ads / day. Beyond that, an **ad ticket** is bought for `15 coins` and yields `30 coins` on a verified watch → net **+15** for the user.
- Hard cap `30 ads / day` (network safety: Adsgram emits `onNonStopShow` / `onTooLongSession`).
- The extra-slot mechanic is the core accelerator: more ads → more coins **and** faster progress toward the §9 revenue gate.

### 2.8 Referrals

- Single level only. `10%` of each qualified invitee's coins, paid as coins, at the moment the invitee earns.
- Qualification: invitee is ≥ 3 days old, ≥ 5,000 taps, ≥ 50 ad views, `est_revenue_micro ≥ 1,000`.
- Payout delay 24 h; clawback allowed via ledger entry `type = 'clawback'`.
- Caps: `20,000 coins / day`, `200 active referrals`.
- Anti-farm: one referrer per account, self-referral block, IP `/24` clustering, Telegram account-age check (§10.4).

### 2.9 Gift ladder and redemption pricing

| ⁦Gift⁩ | ⁦Price (Stars)⁩ | ⁦Price (coins)⁩ | ⁦Unlocks⁩ |
|---|---|---|---|
| ⁦Starter⁩ | ⁦15⁩ | ⁦300,000⁩ | ⁦from day 1⁩ |
| ⁦Standard⁩ | ⁦25⁩ | ⁦500,000⁩ | ⁦after first delivery⁩ |
| ⁦Premium⁩ | ⁦50⁩ | ⁦1,000,000⁩ | ⁦30 days of activity⁩ |

Gift IDs and live prices come from `getAvailableGifts` at request time. Never hardcode the catalog.

### 2.10 Coin packs (Stars → coins)

Selling coins is optional but must never be arbitrageable:

```
pack_cost_stars >= (coins_in_pack / 20,000) * 1.2
```

Example: a 500,000-coin pack must cost **≥ 30 Stars** (it redeems for 25 Stars' worth). Validate at purchase time and block any pack violating the rule.

### 2.11 Unit economics

Assumptions: `$0.02` per Star, `$0.001` per ad view (blended CPM), `1 coin = $0.000001`.

| ⁦Tier⁩ | ⁦Coins / h⁩ | ⁦Payout value / h⁩ | ⁦Ads / h⁩ | ⁦Revenue / h⁩ | ⁦Margin⁩ |
|---|---|---|---|---|---|
| ⁦Lazy⁩ | ⁦500⁩ | ⁦$0.00050⁩ | ⁦4⁩ | ⁦$0.0040⁩ | ⁦8.0×⁩ |
| ⁦Mid⁩ | ⁦1,600⁩ | ⁦$0.00160⁩ | ⁦8⁩ | ⁦$0.0080⁩ | ⁦5.0×⁩ |
| ⁦Active⁩ | ⁦2,500⁩ | ⁦$0.00250⁩ | ⁦5⁩ | ⁦$0.0050⁩ | ⁦2.0×⁩ |
| ⁦Very active⁩ | ⁦3,000⁩ | ⁦$0.00300⁩ | ⁦7.5⁩ | ⁦$0.0075⁩ | ⁦2.5×⁩ |

Margin is thinnest at the top tier by design; §9's revenue gate and §9.5 caps are what keep it positive in practice. Re-measure with real Adsgram CPM after launch and adjust `coins_per_star` (or ad reward) rather than the gate.

### 2.12 Invariants (enforced in DB + cron)

1. `users.balance = SUM(transactions.delta)` for every user, always.
2. `users.balance >= 0` (DB `CHECK`).
3. `energy <= energy_cap(upgrades)` and `energy >= 0`.
4. `redemptions` in `sent`/`delivered` state ≤ `payouts_weekly_cap_per_user`.
5. Global Stars spend in the last 30 days ≤ `payout_budget_ratio × trailing 30-day ad revenue`.
6. `lifetime_coins_earned` never decreases (except an audited admin adjustment).

---

## §3 User workflow

### 3.1 Session loop (5 – 10 min, every 1 – 2 h)

```
open
 → collect worker income            (chest + haptic feedback)
 → daily check-in                   (if new UTC day)
 → tap until energy = 0             (~50 taps in 5 min)
 → STORE PROMPT fires at energy = 0 ("next Tap Power 1,240 / 2,000")
 → 2–3 ads to continue
 → leave with an unfinished goal    (open-loop retention)
```

**Hard UX requirement:** the store prompt is triggered by the energy-empty event, not by a tab visit.

### 3.2 Daily loop

| ⁦Moment⁩ | ⁦Event⁩ |
|---|---|
| ⁦00:00 UTC⁩ | ⁦daily gift, quest set, ad counters, leaderboard window reset⁩ |
| ⁦First open⁩ | ⁦worker chest → 5 daily quests (~10 min)⁩ |
| ⁦Push 1⁩ | ⁦"Workers finished — 4,200 coins waiting"⁩ |
| ⁦Push 2⁩ | ⁦"Streak ends in 6 h" (only when genuinely close)⁩ |
| ⁦Never⁩ | ⁦more than 2 bot messages / day; stop after 2 consecutive ignores⁩ |

### 3.3 Weekly loop

Weekly quest chain (7 check-ins → 30,000 coins) · gift-ladder step unlock · one limited-time upgrade discount. The weekly leaderboard is deferred to v1.1 (ADR-0005).

### 3.4 Lifetime arc

| ⁦When⁩ | ⁦Milestone⁩ |
|---|---|
| ⁦0 – 5 min⁩ | ⁦first upgrade (teaches the loop)⁩ |
| ⁦~1 h⁩ | ⁦first worker rental (teaches return)⁩ |
| ⁦~1 day⁩ | ⁦first milestone chest⁩ |
| ⁦3 – 7 days⁩ | ⁦first 50,000 coins; gift progress bar visible⁩ |
| ⁦4 – 8 weeks⁩ | ⁦first gift (active users)⁩ |
| ⁦after⁩ | ⁦gift ladder + prestige arc⁩ |

### 3.5 Screens

`Tap` (home) · `Store` · `Tasks` · `Friends` · `Wallet` · `Admin` (hidden unless `is_admin`).

Every screen: Telegram theme variables, safe-area insets, haptics on meaningful actions, `MainButton` only for the primary action of that screen.

---

## §4 Architecture

### 4.1 Stack

| ⁦Layer⁩ | ⁦Choice⁩ |
|---|---|
| ⁦Framework⁩ | ⁦Next.js 15 (App Router) + TypeScript + Tailwind CSS⁩ |
| ⁦Data⁩ | ⁦Postgres (Neon) + Drizzle ORM (forward-only migrations)⁩ |
| ⁦Bot⁩ | ⁦grammY, webhook mode (no polling — serverless)⁩ |
| ⁦Client state⁩ | ⁦TanStack Query + Zod on every request/response⁩ |
| ⁦Cache / limits⁩ | ⁦Upstash Redis (token buckets, nonces, hot counters)⁩ |
| ⁦Ads⁩ | ⁦Adsgram SDK behind a provider interface (`mock` in dev)⁩ |
| ⁦Hosting⁩ | ⁦Vercel + Vercel Cron⁩ |
| ⁦Errors⁩ | ⁦Sentry + structured JSON logs (`telegram_id`, `request_id`, `route`)⁩ |

### 4.2 Repository layout

```
/
├─ PLAN.md · AGENT.md
├─ next.config.ts · tsconfig.json · drizzle.config.ts · .env.example
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx · page.tsx (Tap) · globals.css
│  │  ├─ store/ · tasks/ · friends/ · wallet/ · admin/
│  │  └─ api/
│  │     ├─ auth/telegram/ · state/
│  │     ├─ tap/
│  │     ├─ store/purchase/ · workers/rent/ · workers/collect/
│  │     ├─ tasks/ · tasks/ad/start/ · tasks/ad/claim/
│  │     ├─ adsgram/reward/
│  │     ├─ referrals/
│  │     ├─ shop/coins/
│  │     ├─ webhook/telegram/
│  │     ├─ redeem/ · admin/redemption/
│  │     ├─ cron/reconcile/ · cron/reset/
│  │     └─ health/
│  ├─ db/ schema.ts · client.ts · migrations/ · seed.ts
│  ├─ server/
│  │  ├─ auth/init-data.ts
│  │  ├─ economy/ ledger · energy · momentum · store · workers · pricing
│  │  ├─ security/ ratelimit · nonce · anomaly · gate
│  │  ├─ telegram/ bot · notify · gifts
│  │  ├─ ads/ provider · mock · adsgram
│  │  └─ config/ settings.ts
│  ├─ components/ · lib/ (types.ts · schemas.ts · format.ts)
├─ scripts/ simulate-economy.ts · set-webhook.ts · check-gifts.ts
└─ tests/ unit/ · integration/ · e2e/
```

### 4.3 Environments

| ⁦Env⁩ | ⁦Web app⁩ | ⁦Bot⁩ | ⁦DB⁩ |
|---|---|---|---|
| ⁦Local⁩ | ⁦`next dev` + `cloudflared` tunnel⁩ | ⁦test bot⁩ | ⁦local Postgres⁩ |
| ⁦Preview⁩ | ⁦Vercel preview⁩ | ⁦test bot (same webhook secret)⁩ | ⁦branch DB⁩ |
| ⁦Production⁩ | ⁦Vercel prod⁩ | ⁦main bot⁩ | ⁦Neon prod⁩ |

### 4.4 Config and settings

All economy numbers live in the `settings` table (typed, validated by Zod, cached 60 s). No economy constant may be hardcoded in application code. See §12.

### 4.5 Background jobs (Vercel Cron)

| ⁦Job⁩ | ⁦Schedule⁩ | ⁦Purpose⁩ |
|---|---|---|
| ⁦`cron/reset`⁩ | ⁦00:00 UTC⁩ | ⁦daily counters, quest sets, leaderboard window⁩ |
| ⁦`cron/reconcile`⁩ | ⁦hourly⁩ | ⁦ledger vs balance, anomaly scan, flag freeze⁩ |
| ⁦`cron/payouts`⁩ | ⁦every 15 min⁩ | ⁦process approved redemption queue, retries⁩ |
| ⁦`cron/notify`⁩ | ⁦hourly⁩ | ⁦worker-finished + streak-ending pushes⁩ |

---

## §5 Data model

### 5.1 Core tables

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT, first_name TEXT, photo_url TEXT, language_code TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  energy INT NOT NULL DEFAULT 50,
  energy_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  momentum NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  momentum_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  streak_days INT NOT NULL DEFAULT 0,
  last_checkin_date DATE,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by BIGINT REFERENCES users(id),
  referral_unlock BOOLEAN NOT NULL DEFAULT FALSE,
  lifetime_coins_earned BIGINT NOT NULL DEFAULT 0,
  lifetime_ad_views INT NOT NULL DEFAULT 0,
  est_revenue_micro BIGINT NOT NULL DEFAULT 0,
  risk_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  delta BIGINT NOT NULL,
  type TEXT NOT NULL,             -- tap|ad|daily|signup|quest|referral|
                                  -- worker_collect|store_purchase|worker_rent|
                                  -- redemption_lock|redemption_refund|
                                  -- clawback|stars_purchase|admin_adjust
  ref_id TEXT,
  idempotency_key TEXT UNIQUE,
  momentum NUMERIC(4,2),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON transactions (user_id, created_at DESC);

CREATE TABLE daily_activity (
  user_id BIGINT NOT NULL REFERENCES users(id),
  date_key DATE NOT NULL,
  taps INT NOT NULL DEFAULT 0,
  ads_watched INT NOT NULL DEFAULT 0,
  seconds_active INT NOT NULL DEFAULT 0,
  quests_done INT NOT NULL DEFAULT 0,
  coins_earned BIGINT NOT NULL DEFAULT 0,
  momentum_snapshot NUMERIC(4,2),
  PRIMARY KEY (user_id, date_key)
);

CREATE TABLE upgrades (
  user_id BIGINT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,             -- tap_power|energy_cap|regen
  level INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE workers (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  tier INT NOT NULL,              -- 1|2|3
  rental_started_at TIMESTAMPTZ NOT NULL,
  rental_ends_at TIMESTAMPTZ NOT NULL,
  last_collected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ad_tickets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  nonce TEXT UNIQUE NOT NULL,
  price_paid BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE ad_views (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,         -- mock|adsgram
  nonce TEXT UNIQUE NOT NULL,
  rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  telegram_payment_charge_id TEXT UNIQUE NOT NULL,
  stars INT NOT NULL,
  coins BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE redemptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  coins BIGINT NOT NULL,
  gift_id TEXT NOT NULL,
  stars INT NOT NULL,
  status TEXT NOT NULL,           -- requested|approved|sent|delivered|failed|refunded|rejected
  admin_message_id BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE referrals (
  referrer_id BIGINT NOT NULL REFERENCES users(id),
  invitee_id BIGINT NOT NULL UNIQUE REFERENCES users(id),
  qualified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (referrer_id, invitee_id)
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE admin_audit (id BIGSERIAL PRIMARY KEY, admin_id BIGINT NOT NULL, action TEXT NOT NULL, payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE anomalies (id BIGSERIAL PRIMARY KEY, user_id BIGINT, kind TEXT NOT NULL, score NUMERIC, payload JSONB, resolved BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
```

### 5.2 Rules

- Money is `BIGINT` only. No floats anywhere in the money path.
- Every balance mutation goes through `server/economy/ledger.ts#post()` inside one DB transaction with `SELECT … FOR UPDATE` on the user row.
- `transactions.idempotency_key` is required for every non-tap mutation.
- Migrations are forward-only; never edit a shipped migration.

---

## §6 API surface

All routes are `POST` unless noted. All require a valid `X-Telegram-Init-Data` header except `webhook/*`, `cron/*`, `health`.

| ⁦Route⁩ | ⁦Purpose⁩ | ⁦Auth⁩ | ⁦Rate limit⁩ | ⁦Idempotency⁩ |
|---|---|---|---|---|
| ⁦`POST /api/auth/telegram`⁩ | ⁦validate initData, upsert user, return bootstrap state⁩ | ⁦initData⁩ | ⁦10/min⁩ | ⁦—⁩ |
| ⁦`GET /api/state`⁩ | ⁦balance, energy, M, quests, timers⁩ | ⁦initData⁩ | ⁦60/min⁩ | ⁦—⁩ |
| ⁦`POST /api/tap`⁩ | ⁦batch of taps + client ts → server energy math⁩ | ⁦initData⁩ | ⁦20/s⁩ | ⁦nonce⁩ |
| ⁦`POST /api/store/purchase`⁩ | ⁦buy upgrade / consumable⁩ | ⁦initData⁩ | ⁦10/min⁩ | ⁦required⁩ |
| ⁦`POST /api/workers/rent`⁩ | ⁦rent a worker tier⁩ | ⁦initData⁩ | ⁦5/min⁩ | ⁦required⁩ |
| ⁦`POST /api/workers/collect`⁩ | ⁦collect accrued coins⁩ | ⁦initData⁩ | ⁦10/min⁩ | ⁦required⁩ |
| ⁦`GET /api/tasks`⁩ | ⁦daily quests + ad availability⁩ | ⁦initData⁩ | ⁦60/min⁩ | ⁦—⁩ |
| ⁦`POST /api/tasks/ad/start`⁩ | ⁦issue ad nonce (free or ticket)⁩ | ⁦initData⁩ | ⁦10/min⁩ | ⁦—⁩ |
| ⁦`POST /api/tasks/ad/claim`⁩ | ⁦redeem nonce after watch⁩ | ⁦initData⁩ | ⁦10/min⁩ | ⁦nonce⁩ |
| ⁦`GET /api/adsgram/reward`⁩ | ⁦server postback (secret + `[userId]`)⁩ | ⁦secret⁩ | ⁦60/min⁩ | ⁦—⁩ |
| ⁦`GET /api/referrals`⁩ | ⁦code, invitee list, qualification⁩ | ⁦initData⁩ | ⁦30/min⁩ | ⁦—⁩ |
| ⁦`POST /api/shop/coins`⁩ | ⁦create Stars invoice link⁩ | ⁦initData⁩ | ⁦5/min⁩ | ⁦—⁩ |
| ⁦`POST /api/webhook/telegram`⁩ | ⁦bot updates, payments, admin callbacks⁩ | ⁦secret header⁩ | ⁦—⁩ | ⁦by update_id⁩ |
| ⁦`POST /api/redeem`⁩ | ⁦create redemption request⁩ | ⁦initData⁩ | ⁦2/min⁩ | ⁦required⁩ |
| ⁦`POST /api/admin/redemption`⁩ | ⁦approve / reject⁩ | ⁦admin + signed callback⁩ | ⁦30/min⁩ | ⁦required⁩ |
| ⁦`GET /api/health`⁩ | ⁦db + redis + bot ping⁩ | ⁦—⁩ | ⁦—⁩ | ⁦—⁩ |

**Implemented extensions (orchestrator-approved, M3–M8).** These routes are live but were added after §6 was written:

| Route | Purpose | Auth | Rate limit | Idempotency |
|---|---|---|---|---|
| `GET /api/store` | upgrade/consumable catalog with payback labels | initData | 60/min | — |
| `POST /api/tasks/checkin` | daily gift, streak and weekly chain | initData | 5/min | required |
| `POST /api/tasks/quest` | claim one daily quest | initData | 10/min | per quest/day |
| `POST /api/heartbeat` | authorised active-time heartbeat for momentum | initData | 30/min | nonce |
| `GET /api/admin/redemption` | queue overview + pre-signed admin `callbackData` | admin allowlist | 60/min | — |
| `POST /api/admin/settings` | validated settings update with `admin_audit` row | admin allowlist | 10/min | — |
| `GET /api/cron/{reset,reconcile,payouts,notify}` | scheduled jobs (§4.5) | `CRON_SECRET` | — | job idempotent |

Error contract: `{ error: { code, message, retryable } }`. Never leak stack traces or SQL.

---

## §7 Telegram integration

### 7.1 Web app bootstrap

1. Load `https://telegram.org/js/telegram-web-app.js` before hydration.
2. `WebApp.ready()` · `expand()` · `setHeaderColor(theme.bg_color)` · `enableClosingConfirmation()` only on unpaid states.
3. Read `start_param` for `ref_<code>`; store it for the first `/api/auth/telegram` call.
4. All UI reads `initDataUnsafe` for **display only**; every request sends the raw `initData` string.

### 7.2 initData validation (server, every request)

```
secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)
expected   = HMAC_SHA256_hex(key=secret_key, data=data_check_string)
valid      = timingSafeEqual(expected, hash) && auth_date >= now - 3600
```

Reject with `401` on failure. Cache the parsed user for 60 s keyed by `hash`.

### 7.3 Bot and webhook

- grammY, `webhookCallback`, path `/api/webhook/telegram`.
- `setWebhook` with `secret_token`; verify `X-Telegram-Bot-Api-Secret-Token` before parsing.
- Commands: `/start` (WebApp button + referral parse), `/app`, `/balance`, `/help`, `/admin` (allowlisted ID only).
- Menu button set to the Mini App URL.

### 7.4 Deep links

`https://t.me/<bot>?startapp=ref_<code>` → `initData.start_param` → `referrals` row on first auth. Validate the code exists, is not the user, and the user has no existing referrer.

### 7.5 Stars payments

1. `createInvoiceLink({ currency: "XTR", prices: [{ label, amount: stars }] })` — no `provider_token` for Stars.
2. Webhook `pre_checkout_query` → answer within 10 s.
3. Webhook `message.successful_payment` → verify `telegram_payment_charge_id` uniqueness → credit coins in one transaction.
4. Never trust client-side success callbacks.

### 7.6 Gift sending

- Catalog from `getAvailableGifts` (cache 10 min); gifts are paid from the **bot Stars balance**.
- `sendGift({ user_id, gift_id, text })`; handle `STARGIFT_USAGE_LIMITED` and insufficient balance.
- Gifts cannot be converted to Stars by the receiver — say so in the wallet copy.
- Only the payout worker (§9) may call this, never a user-facing request.

---

## §8 Ads integration

Provider interface `server/ads/provider.ts`:

```ts
interface AdProvider {
  id: "mock" | "adsgram";
  createNonce(userId: string): Promise<string>;
  verifyClientClaim(nonce: string, payload: unknown): Promise<boolean>;
  verifyServerPostback(req: Request): Promise<{ userId: string; ok: boolean } | null>;
}
```

- `mock`: dev-only, instant reward, clearly labelled in the UI.
- `adsgram`: client SDK `sad.min.js` + `blockId`; server postback at `GET /api/adsgram/reward?userid=[userId]&secret=…` (available above ~50k DAU — build it now, enable later).
- Below that threshold the control is: server nonce + 30 s cooldown + daily cap + session cross-check (§10.3).
- Never reward twice for one nonce; `ad_views.nonce` is unique.

---

## §9 Redemption workflow

### 9.1 State machine

```
requested ──admin approve──> approved ──cron claims──> sent ──sendGift ok──> delivered
    │                            │
    │                            └──sendGift fail──> failed ──refund──> refunded
    └──admin reject / auto-gate fail──> rejected (coins released)
```

`sent` is written **before** the Telegram call so a crash can never re-send a gift. A `sent` row older than 15 minutes is surfaced by `cron/reconcile` and reconciled manually; it is never retried automatically.

### 9.2 Request-time checks

1. Balance ≥ gift price; coins locked via `redemption_lock` ledger entry (negative delta, `ref_id = redemption id`).
2. Account age ≥ 3 days; ≥ 1,000 taps; ≥ 50 ad views.
3. No open redemption; weekly/monthly caps (§9.5).
4. **Revenue gate:** `est_revenue_micro ≥ 2 × gift_cost_usd_micro`.
5. `risk_flags` empty or admin-overridden.

### 9.3 Approval and delivery

Admin receives a bot DM: user, gift, price, 30-day revenue, risk flags, `[Approve] [Reject]` buttons with signed callback data. On approve, the cron worker checks the bot Stars balance and the daily spend cap, then calls `sendGift`.

### 9.4 Failure handling

`failed` → auto-refund via `redemption_refund` ledger entry, notify the user, alert the admin. Never retry a `sendGift` blindly (idempotency by redemption id).

### 9.5 Caps

| ⁦Cap⁩ | ⁦Value⁩ |
|---|---|
| ⁦Per user / week⁩ | ⁦20 Stars⁩ |
| ⁦Per user / month⁩ | ⁦50 Stars⁩ |
| ⁦Global / 30 days⁩ | ⁦40% of trailing 30-day ad revenue⁩ |
| ⁦Global behaviour at cap⁩ | ⁦auto-pause queue + admin alert (never silent failure)⁩ |

---

## §10 Security and anti-cheat

### 10.1 Threat model (summary)

Forged identity · tap/macro bots · replay and double-spend · ad fraud · payment fraud · multi-account farms · balance tampering · offline-income inflation · admin compromise · gift-delivery abuse.

### 10.2 Money rules (highest priority, non-negotiable)

1. The client never sends a coin amount, a multiplier, or a balance.
2. Every balance change is a ledger row inside a DB transaction with row locking.
3. Every mutating endpoint has an idempotency key and a rate limit.
4. No endpoint trusts `initDataUnsafe`; only validated `initData`.
5. Payouts only through the queue in §9, only with admin approval and caps.

### 10.3 Control matrix

| ⁦Attack⁩ | ⁦Control⁩ |
|---|---|
| ⁦Forged identity⁩ | ⁦HMAC-SHA256 initData validation, `auth_date` ≤ 1 h, timing-safe compare, 60 s cache keyed by hash⁩ |
| ⁦Fake taps / macro⁩ | ⁦server computes energy from `energy_updated_at`; client tap counts are claims with a per-request ceiling; token bucket per user + per IP⁩ |
| ⁦Perfectly regular taps⁩ | ⁦inter-tap interval coefficient of variation < 0.05 → flag, zero the day's duration bonus⁩ |
| ⁦Play-time farming (app left open)⁩ | ⁦signed heartbeat with nonce; requires an interaction in the last 5 min; credited time capped at 240 min/day; hidden-tab beats ignored⁩ |
| ⁦Replay / double-spend⁩ | ⁦single-use nonces (unique index), idempotency keys, `SELECT … FOR UPDATE`⁩ |
| ⁦Ad fraud⁩ | ⁦nonce + 30 s cooldown + daily cap + session cross-check; Adsgram postback secret once enabled⁩ |
| ⁦Ticket abuse (buy → claim → refund)⁩ | ⁦charge and ticket issue in one transaction; single-use nonce; expire at 00:00 UTC⁩ |
| ⁦Payment fraud⁩ | ⁦unique `telegram_payment_charge_id`; amount from the Telegram update, never the client⁩ |
| ⁦Multi-account farms⁩ | ⁦referral qualification + 24 h delay + IP `/24` clustering + account-age check + clawback journal⁩ |
| ⁦Balance tampering⁩ | ⁦DB `CHECK balance >= 0`, ledger is source of truth, hourly reconciliation freezes mismatches⁩ |
| ⁦Offline-income inflation⁩ | ⁦server clock only, 8 h accrual cap, accrual ends at `rental_ends_at`⁩ |
| ⁦Admin compromise⁩ | ⁦allowlist by Telegram ID, signed callback data, full audit log, spend caps, kill switch⁩ |
| ⁦Burst earnings⁩ | ⁦`max_daily_coins` 50,000 and per-source caps⁩ |

### 10.4 Referral farm detection

Freeze a referral cluster when: ≥ 5 signups from one IP in 24 h · invitee Telegram account younger than 48 h · same device fingerprint across ≥ 3 accounts · invitee never plays beyond the qualification threshold. Freezes go to `anomalies`, never auto-ban without admin review.

### 10.5 Kill switches

`ads`, `payouts`, `store` flags in `settings`. Toggling is instant, audited, and must degrade gracefully (tap loop keeps working if ads die).

---

## §11 Reliability and quality

### 11.1 Test matrix

| ⁦Layer⁩ | ⁦Required tests⁩ |
|---|---|
| ⁦Unit⁩ | ⁦energy math, momentum computation, upgrade pricing, pack-arbitrage rule, gate math⁩ |
| ⁦Integration⁩ | ⁦ledger invariants under concurrency, payment idempotency, ad nonce single-use, redemption refund⁩ |
| ⁦E2E⁩ | ⁦first session, daily loop, ad watch, referral, redemption request + admin approval (staging bot)⁩ |
| ⁦Simulation⁩ | ⁦§11.6 economy simulator must pass its hour targets⁩ |
| ⁦Fraud sim⁩ | ⁦replayed requests, 24/7 heartbeat, burst taps — all must be rejected or flagged⁩ |

### 11.2 Observability

Sentry (server + client) · structured logs with `request_id`, `telegram_id`, `route`, `duration_ms` · counters for `coins_minted`, `gifts_sent`, `stars_spent`, `ad_views` · alert if `payout ratio > 40%` or reconciliation drift > 0.

### 11.3 Migrations and seeds

Forward-only Drizzle migrations, reviewed by `data-agent`. `db/seed.ts` creates settings defaults and a demo user. Never run destructive migrations in production without a backup.

### 11.4 Backups

Neon daily point-in-time restore, verified quarterly by a restore drill. `settings` exported weekly as JSON.

### 11.5 Bug prevention

Feature flags for every new mechanic · staging bot for all Telegram flows · no economy constant outside `settings` · every endpoint has a Zod schema · typed error codes · CI blocks on typecheck + tests.

### 11.6 Economy simulator (gate)

`scripts/simulate-economy.ts` runs the four personas (§2.4) for 365 simulated days using the real `momentum` and `pricing` modules, and **fails the build** if:

- lazy hours ∉ [500, 750]
- mid hours ∉ [180, 220]
- active hours ∉ [110, 150]
- very active hours ∉ [85, 100]
- any persona's average `M` ∉ [0.8, 6.3]
- any persona's 30-day margin < 1.5×
- any store upgrade level's payback ∉ [2, 6] h at the reference momentum
- the fully-maxed base rate exceeds `3 ×` the base rate

Last recorded run: lazy 750 h, mid 189 h, active 144 h, very active 99 h; margins 10.00× / 5.04× / 2.30× / 2.47×. All store levels green.

---

## §12 Settings reference

```jsonc
{
  "economy": {
    "coins_per_star": 20000,
    "signup_coins": 20000,
    "daily_gift": [5000, 7000, 10000],
    "tap_reward": 10,
    "energy_cap": 50,
    "regen_seconds": 72,
    "ad_reward": 30,
    "free_ads_per_day": 10,
    "extra_ad_slot_price": 15,
    "max_ads_per_day": 30,
    "ad_cooldown_seconds": 30,
    "ad_revenue_micro": 1000,
    "worker_output_per_hour": [50, 150, 400],
    "worker_rent_per_hour": [30, 100, 280],
    "worker_max_offline_hours": 8,
    "referral_rate": 0.10,
    "referral_daily_cap": 20000,
    "referral_max_active": 200,
    "max_daily_coins": 50000,
    "tap_power_step": 2,
    "tap_power_max_level": 5,
    "energy_cap_step": 25,
    "energy_cap_max_level": 4,
    "regen_step_pct": 0.10,
    "regen_max_level": 3,
    "store_costs": {
      "tap_power": { "base": 800, "growth": 1.18 },
      "energy_cap": { "base": 1500, "growth": 1.25 },
      "regen": { "base": 500, "growth": 1.30 }
    },
    "consumables": {
      "double_tap": { "price": 15000, "duration_seconds": 1800 },
      "full_energy": { "price": 25000 },
      "auto_tap": { "price": 60000, "duration_seconds": 900 }
    },
    "daily_quests": [
      { "id": "taps_300", "metric": "taps", "target": 300, "reward": 1500 },
      { "id": "ads_3", "metric": "ads", "target": 3, "reward": 2000 },
      { "id": "earn_5000", "metric": "coins", "target": 5000, "reward": 2500 },
      { "id": "purchase_1", "metric": "purchases", "target": 1, "reward": 2000 },
      { "id": "rent_worker", "metric": "workers", "target": 1, "reward": 1500 }
    ],
    "weekly_quest_reward": 30000,
    "coin_packs": [
      { "id": "pack_100k", "coins": 100000, "stars": 10 },
      { "id": "pack_500k", "coins": 500000, "stars": 30 },
      { "id": "pack_1m", "coins": 1000000, "stars": 60 }
    ],
    "pack_margin": 1.2,
    "base_rate_cap_multiplier": 3,
    "payback_reference_momentum": 3,
    "payback_min_hours": 2,
    "payback_max_hours": 6
  },
  "momentum": {
    "base": 1.0, "streak_per_day": 0.2, "streak_cap": 1.0,
    "duration_tiers": [0.4, 0.8, 1.2, 1.7],
    "duration_thresholds_min": [30, 90, 180, 240],
    "daily_quests": 0.4, "weekly_quests": 0.4, "ads_bonus": 0.4,
    "ads_threshold": 10,
    "referral_bonus": 0.2, "referral_cap": 1.2,
    "absence_penalty": 0.3, "min": 0.8, "max": 6.3
  },
  "payouts": {
    "gifts": { "starter": 300000, "standard": 500000, "premium": 1000000 },
    "gift_prices_stars": { "starter": 15, "standard": 25, "premium": 50 },
    "gift_ids": { "starter": "", "standard": "", "premium": "" },
    "min_account_age_days": 3,
    "min_taps": 1000,
    "min_ad_views": 50,
    "min_revenue_micro": 1000,
    "revenue_multiplier": 2.0,
    "weekly_cap_stars": 20,
    "monthly_cap_stars": 50,
    "global_budget_ratio": 0.40,
    "star_value_micro": 20000,
    "referral_payout_delay_hours": 24,
    "referral_qualification": {
      "min_age_days": 3,
      "min_taps": 5000,
      "min_ad_views": 50,
      "min_revenue_micro": 1000
    }
  },
  "flags": { "ads": true, "payouts": true, "store": true },
  "security": {
    "max_taps_per_request": 50,
    "min_tap_interval_ms": 120,
    "tap_cv_threshold": 0.05,
    "heartbeat_window_seconds": 300,
    "max_daily_minutes": 240,
    "auth_max_age_seconds": 3600,
    "initdata_cache_seconds": 60,
    "initdata_cache_size": 2000,
    "reconcile_drift_threshold": 0,
    "webhook_max_age_seconds": 300,
    "admin_callback_max_age_seconds": 900
  }
}
```

---

## §13 Build milestones

| ⁦ID⁩ | ⁦Milestone⁩ | ⁦Exit criteria⁩ | ⁦Owner⁩ |
|---|---|---|---|
| ⁦M0⁩ | ⁦Scaffold⁩ | ⁦Next.js + Tailwind + Drizzle + Zod env; `/api/health` green; CI typecheck⁩ | ⁦orchestrator⁩ |
| ⁦M1⁩ | ⁦Schema + auth + ledger⁩ | ⁦migrations applied; initData validation tested; `post()` ledger with concurrency test⁩ | ⁦data-agent⁩ |
| ⁦M2⁩ | ⁦Tap + energy + momentum + simulator⁩ | ⁦simulator passes §11.6; anti-macro flags fire in tests⁩ | ⁦economy-agent⁩ |
| ⁦M3⁩ | ⁦Store + workers⁩ | ⁦upgrade payback 2–6 h verified; worker accrual server-side; idempotent purchases⁩ | ⁦economy-agent⁩ |
| ⁦M4⁩ | ⁦Daily loop + bot pushes⁩ | ⁦check-in, quests, streaks, 2/day push cap, opt-out honored⁩ | ⁦telegram-agent⁩ |
| ⁦M5⁩ | ⁦Ads (mock + Adsgram)⁩ | ⁦nonce single-use, cooldown, cap, ticket flow, postback endpoint ready⁩ | ⁦telegram-agent⁩ |
| ⁦M6⁩ | ⁦Referrals⁩ | ⁦qualification, 24 h delay, cluster freeze (leaderboard deferred, ADR-0005)⁩ | ⁦data-agent⁩ |
| ⁦M7⁩ | ⁦Stars purchases⁩ | ⁦pre_checkout answered < 10 s, idempotent credit, arbitrage rule enforced⁩ | ⁦telegram-agent⁩ |
| ⁦M8⁩ | ⁦Redemption + admin⁩ | ⁦state machine covered by tests; refund path; caps + kill switch; audit log⁩ | ⁦payout-agent⁩ |
| ⁦M9⁩ | ⁦Hardening + launch⁩ | ⁦reconcile cron, Sentry, fraud sim green, launch checklist complete⁩ | ⁦security-agent⁩ |

---

## §14 Launch checklist

- [ ] Bot created, `/newapp` configured, Mini App URL set (HTTPS).
- [ ] Webhook set with `secret_token`; `getWebhookInfo` shows no errors.
- [ ] `settings` seeded; `coins_per_star`, gift prices, caps reviewed.
- [ ] Gift catalog verified with `scripts/check-gifts.ts`; bot Stars balance > 3 weeks of payouts.
- [ ] Adsgram platform + block approved (or `mock` provider in staging only).
- [ ] Vercel env vars set: `BOT_TOKEN`, `DATABASE_URL`, `REDIS_URL`, `WEBHOOK_SECRET`, `ADMIN_IDS`, `ADSGRAM_BLOCK_ID`, `ADSGRAM_SECRET`, `SENTRY_DSN`.
- [ ] Cron jobs registered and returning 200.
- [ ] Kill-switch drill: disable ads, payouts, store — app stays usable.
- [ ] Restore drill: branch DB restored, app boots.
- [ ] Monitoring alerts live: payout ratio, reconciliation drift, webhook failures.

---

## §15 Risks and open decisions

| ⁦Risk⁩ | ⁦Impact⁩ | ⁦Mitigation⁩ |
|---|---|---|
| ⁦Adsgram CPM lower than assumed ($0.0005)⁩ | ⁦payout margin halves⁩ | ⁦revenue gate + raise `coins_per_star`; measure per country before scaling⁩ |
| ⁦Telegram restricts gift sending / catalog changes⁩ | ⁦payout channel breaks⁩ | ⁦payouts kill switch; fallback to a smaller gift tier; monitor Bot API changelog⁩ |
| ⁦TikTok-style churn before first gift⁩ | ⁦low retention, no payouts⁩ | ⁦upgrade-payback rewards early; milestone chests; weekly quests⁩ |
| ⁦Multi-account farming⁩ | ⁦Stars drain⁩ | ⁦revenue gate is the real wall; cluster detection + clawbacks⁩ |
| ⁦Admin conflict (user disputes)⁩ | ⁦support load⁩ | ⁦full ledger + audit trail; show gift receipts in wallet⁩ |
| ⁦Vercel serverless limits⁩ | ⁦webhook timeouts⁩ | ⁦keep handlers < 2 s; heavy work in cron; idempotent retries⁩ |

Open decisions (need owner input before M8): final gift tiers, whether coin packs launch at v1, and the exact refund copy for failed gift deliveries.

---

## §16 Glossary

| ⁦Term⁩ | ⁦Meaning⁩ |
|---|---|
| ⁦Tap⁩ | ⁦Single tap action; base reward 10 coins × M⁩ |
| ⁦Momentum (M)⁩ | ⁦Server-computed engagement multiplier, 0.8 – 6.3⁩ |
| ⁦Energy⁩ | ⁦Tap budget, regenerates 1 / 60 s, cap 50 (upgradeable)⁩ |
| ⁦Worker⁩ | ⁦Rented offline income source, priced below output⁩ |
| ⁦Ticket⁩ | ⁦Purchased extra ad slot (15 coins)⁩ |
| ⁦Gift ladder⁩ | ⁦15 / 25 / 50 Star Telegram gifts ordered by price⁩ |
| ⁦Revenue gate⁩ | ⁦Requirement that a user's ad revenue ≥ 2× the gift cost before payout⁩ |
| ⁦Redemption⁩ | ⁦Coins → Telegram gift, via admin-approved queue⁩ |
| ⁦Ledger⁩ | ⁦Append-only transaction table; the only source of truth for balances⁩ |
