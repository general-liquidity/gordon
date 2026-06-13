---
name: turn-of-month-spy
strategy: seasonal-turn-of-month
status: verified
regime: [ranging, trending_up, quiet]
instruments: [SPY]
---

## Hypothesis

Around the turn of the month, US equity indices drift up on recurring mechanical
flow — month-end pension/401(k) contributions, index-fund rebalancing, and
institutional window-dressing all bid equities in the last few sessions of a
month and the first few of the next. The edge is the predictability of that flow,
not a directional forecast: who is on the other side is a calendar of passive
buyers who must transact on a schedule regardless of price. It holds only while
the calendar segment still carries positive expectancy after costs, and it dies
when the effect is arbitraged away or a risk-off regime swamps the seasonal bid
(the flow still happens, but it's overwhelmed). This is a SEASONAL edge — its
falsifiable core is a calendar segment with positive expectancy (`calendar-effect`),
not a microstructure signal — which is the point: EDD's unit is any falsifiable
thesis, not only an orderflow one.

## Invariants

| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| tom-effect-significant | tomEffectTStat | >= | 2 | Turn-of-month return segment still significant (calendar-effect.ts t-stat) |
| ev-net-positive | netEdgeBps | > | 0 | Seasonal edge survives the round-trip cost |
| winrate-floor | winRate | >= | 0.55 | Realized win rate consistent with a positive-drift seasonal |
| regime-not-riskoff | regime | not-in | volatile | A risk-off regime swamps the seasonal bid |

## Kill Conditions

| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| tom-effect-decayed | tomEffectPValue | > | 0.1 | Calendar effect no longer significant — arbitraged away |
| ev-decayed | netEdgeBps | <= | 0 | Net edge gone after costs |
| winrate-broke | winRate | < | 0.5 | Win rate fell to a coin flip — the drift is gone |
| regime-crash | regime | == | volatile | Sustained risk-off — seasonal flow overwhelmed |

## Verification

Gauntlet via `core/alpha/calendar-effect.ts` over ~20y SPY daily returns segmented
by `day_of_month` + `week_of_month`: the turn-of-month window (last 3 + first 2
sessions) must show mean > 0 with t-stat >= 2 and a "robust" significance tier
(n in the thousands; the Wilson CI on positive-rate excludes 0.5). Per the source's
own caveat — earnings-season ≈ end-of-month — the segment must beat a plain
turn-of-month baseline, not merely be positive. `walk-forward-ic` across rolling
5y folds (calendar effects are notorious for looking present in-sample and failing
out-of-sample); `too-good-check` fires if t-stat > 3 at retail single-operator
scale. Net of an equity round-trip cost assumption (ic-tracker). Incubated in paper
for ≥ 6 month-turns before promotion to `status: live`.

Note: `tomEffectTStat` / `tomEffectPValue` are calendar-effect.ts outputs, supplied
at the verify-gauntlet step — the live monitor evaluates the ledger-derived
invariants (`netEdgeBps`, `winRate`) and fails safe on the seasonal-specific ones
until a calendar-effect metric feed is wired.
