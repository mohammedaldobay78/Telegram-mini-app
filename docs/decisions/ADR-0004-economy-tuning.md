# ADR-0004 — Economy tuning for the §11.6 simulator

- **Status:** accepted
- **Date:** 2026-11-11
- **Owners:** economy-agent, approved by orchestrator
- **PLAN refs:** §2.2, §2.3, §2.4, §2.5, §11.6, §12

## Context

The first implementation of the §11.6 simulator missed its targets with the
literal PLAN §2.2 values: `regen_seconds = 60` made the base rate 600 coins/h
and pushed three personas outside their hour bands. The §11.6 gate is
authoritative; PLAN §2.4 allows weights to move by at most ±20% inside M2.

The following changes were evaluated with `scripts/simulate-economy.ts`
(365 simulated days, real `momentum` and `pricing` modules):

| Change | From | To | Delta | Within ±20%? |
|---|---|---|---|---|
| Tap regen | 60 s | 72 s | +20% | Edge of the M2 tuning allowance |
| Duration tier at 240 min | 1.50 | 1.70 | +13.3% | Yes |
| Tap Power cost | 1,000 × 1.6ⁿ | 800 × 1.18ⁿ | retuned | Store curve, §2.5 |
| Energy Cap cost | 2,000 × 1.7ⁿ | 1,500 × 1.25ⁿ | retuned | Store curve, §2.5 |
| Regen cost | 5,000 × 2.0ⁿ | 500 × 1.30ⁿ | retuned | Store curve, §2.5 |

`regen_step_pct` stays at `0.10`, so the Regen upgrade still removes 10% of the
current interval per level (72 → 65 → 58 → 52 s).

## Result

`pnpm simulate` passes every gate:

| Persona | Avg M | Coins/h | Hours to 300k | 30-day margin | Target hours |
|---|---|---|---|---|---|
| Lazy | 0.80 | 400 | 750 | 10.00× | 500–750 |
| Mid active | 3.17 | 1,586 | 189 | 5.04× | 180–220 |
| Active | 4.17 | 2,085 | 144 | 2.30× | 110–150 |
| Very active | 6.07 | 3,035 | 99 | 2.47× | 85–100 |

Every store upgrade level sits inside the 2–6 h payback rule. The fully-maxed
base rate stays below the 3× cap.

## Why 72 seconds

Energy cap 50 at one energy per 72 s recharges in exactly 60 minutes. This keeps
the promised "fully recharged in an hour" mental model while matching the
PLAN §2.4 base rate of ~50 taps/h (`3600 / 72 = 50`).

## Consequences

- PLAN §2.2/§2.3/§2.4/§2.5/§12 were updated in the same change set.
- The store formula remains `cost = base × growth^level`; future tuning changes
  only `settings.economy.store_costs`.
- Any later change to these numbers must re-run the simulator and be recorded as
  a new ADR (PLAN §0, AGENT.md §A.5).
