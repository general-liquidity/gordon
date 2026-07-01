---
name: setup-model-book
description: "Maintain a persistent model-book of screener candidates and their 3d/5d forward outcomes (MFE/MAE/tags), then roll the cohort up into per-setup rule candidates. When user says /setup-model-book, 'log these screener hits to the model book', 'which of my setups actually pay?', 'update the model book', or 'what setup rules can I mint yet'. A deliberate-practice loop: log what the screener surfaced today, let the book tell you weeks later which setup tags carry edge. Distinct from pattern-edge (validates an edge you already believe in) and hindsight-check (reviews one decision)."
arguments: [action]
argument-hint: "log | mature | stats | rules (default: stats). 'log' freezes today's screener hits; 'mature' fills 3d/5d outcomes for aged candidates; 'stats' shows cohort rollup; 'rules' mints rule candidates."
tags: [learning, screener, deliberate-practice, model-book, setup-fluency]
user-invocable: true
status: active
last-reviewed: 2026-07-01
---

Run the setup model-book, a forward sample-building loop for setup fluency. The book is a persistent JSONL cohort (`setupModelBook.ts`): every screener candidate is frozen at logging time, then auto-updated with 3d and 5d forward outcomes, then rolled up per setup tag into rule candidates. This is deliberate practice, not another retrospective: you are building the sample that will later tell you which setups pay.

This skill drives the store module; it does not invent tools. It uses `get_market_data` for forward bars, `memory_search` / `memory_write` for provenance, and `audit_event` for the log.

## Action: log

Freeze the current screener output into the book. For each candidate the screener (see [[quick-scan]]) surfaced:

1. Capture symbol, side, reference price (last close or planned entry), optional stop / target, and the setup tags that describe WHY it qualified (e.g. `breakout`, `high-volume`, `pullback-to-ma`, `oversold-bounce`).
2. Persist it via `recordCandidate({ id, loggedAt, symbol, side, entryRef, stop, target, setupTags })`.

Log the setup HONESTLY at the time it was seen. The whole value of the book is that the tags are recorded before the outcome is known (no hindsight relabeling).

## Action: mature

Fill forward outcomes for candidates old enough to measure. For each candidate whose `loggedAt` is at least 3 (then 5) trading days old and still missing that horizon:

1. Pull the daily bars since `loggedAt` with `get_market_data` (OHLC, the candidate's timeframe).
2. Compute the outcome with `computeForwardOutcome({ entryRef, side, horizon, bars, stop, target })`. It returns MFE (max favorable excursion), MAE (max adverse excursion), close return, and an outcome tag (`target_hit` / `stopped_out` / `win` / `loss` / `scratch`). Excursions are expressed in the side's favor; the tag resolves adverse-first when a bar touches both stop and target.
3. Persist with `recordOutcome(candidateId, outcome)`.

## Action: stats

Roll the matured cohort up per setup tag:

1. `cohortStats(readModelBook(), { horizon })` returns, per tag: n, matured count, win-rate, avg MFE, avg MAE, MFE/MAE ratio, target-hit rate, stopped rate.
2. Present the tags sorted by matured sample. Call out which tags still lack sample (n high, matured low) so the operator keeps logging them.

## Action: rules

Mint rule candidates from the cohort stats:

1. `deriveRuleCandidates(cohortStats(readModelBook()))`. A tag only mints a rule once it clears the minimum matured sample (default 8) so a two-setup fluke never becomes a rule (aligns with the no-hardcoded-calibration discipline).
2. Each candidate is `prefer` (high win-rate AND MFE/MAE >= threshold) or `avoid` (win-rate <= threshold), with a rationale carrying the stats.
3. Present them as CANDIDATES, not committed rules. Promoting a candidate to an actual strategy rule goes through [[hindsight-check]] (single-signal confirmation-bias check) or [[backtest-validate]] (whole-strategy), never silently.

## Persist the summary

```
memory_write({
  kind: 'observation',
  content: 'Setup model-book update: <N> matured, top tags <...>. Rule candidates: <prefer/avoid list>.',
  tags: ['setup-model-book', '<each minted rule tag>']
})
audit_event({
  action: 'OBSERVATION',
  summary: 'setup-model-book <action>',
  parameters: { action, matured, rule_candidates }
})
```

## Honest caveats

- Outcomes are close-of-day approximations from daily bars; intrabar stop/target ordering is unknown, so the tag resolves adverse-first (conservative). Do not read `stopped_out` as a filled loss on a real order.
- Cohort stats are descriptive, not predictive. A tag with a high win-rate over 8 setups is a candidate to watch, not a validated edge; that is what [[pattern-edge]] and [[backtest-validate]] are for.
- The book records what the screener SURFACED, including rejected candidates. That rejected-candidate history is the deliberate-practice value (it complements the regret-ledger idea): you see the setups you passed on and how they resolved.
- Composes with [[quick-scan]] (feeds candidates), [[trade-performance-coach]] (behavior side of the same loop), and [[weekend-review]] (weekly cadence to run mature + stats + rules).
