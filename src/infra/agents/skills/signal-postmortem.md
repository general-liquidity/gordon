# Signal Postmortem

Root-cause classification of a closed trade. Distinct from `exit-review` (which evaluates exit timing) and `weekend-review` (which surveys the week). The purpose here is to attribute *why* the outcome happened — edge, variance, thesis failure, execution failure, or tilt — so the lesson lands at the right layer.

## When to use

- After any trade closes meaningfully outside the expected outcome (large winner, full stop, premature cut)
- After a sequence of two or more losses in the same strategy — the postmortem may surface that the strategy is the problem, not the individual trades
- User asks "what went wrong" or "why did this work" on a specific trade
- Fired from `exit-review` when the trade classification was "right reason, wrong timing" or "wrong reason"

## The flow

1. **Pull the trade record** — entry/exit prices + times, side, size, realized P&L, fee total, the strategy id that authored the plan.
2. **Reconstruct the entry thesis**:
   - Was an ET1 strategy-level economic thesis recorded for this strategy id? If yes, pull `inefficiencyDescription / counterpartyIdentification / counterpartyConstraint / persistenceRationale` and the thesis hash.
   - Was a per-plan thesis recorded via `recordUserThesis` (explainFirstMode)? Pull it.
   - If neither exists, note this — the postmortem cannot fully attribute without a written thesis.
3. **Replay what Gordon's primitives said at entry**:
   - Regime classification (markovRegime) at entry timestamp
   - Vol regime (KF2 kalmanVolatility)
   - LV1 USD volume gate verdict (was the symbol tradeable?)
   - LV2 level freshness (was the entry level fresh or recycled?)
   - D2 revenge-trade guard verdict (did the operator override a `flag`?)
   - D1 hot-streak sizer classification at entry
   - TM3 market-breadth bias at entry
4. **Replay what fired during the position lifetime**:
   - Did TM1 FTA early-cut fire? Was it ignored?
   - Did TM2 time-based exit fire? Was it ignored?
   - Were any structured observations recorded that flagged adverse conditions?
5. **Score predictions vs realized** — for any probability-emitting component at entry (regime transition probabilities, signal classifications), compute SC1 Brier score over the trade window if data is available.
6. **Classify the outcome** into exactly one category:
   - **edge** — thesis was correct, execution clean, primitives behaved as designed, realized outcome matches expected distribution
   - **variance** — thesis was sound, execution was correct, but the realized outcome was an unlucky draw within the expected distribution
   - **thesis-failure** — the written thesis turned out not to describe the realized counterparty behavior (counterparty wasn't who you said they were, OR the persistence rationale was wrong)
   - **execution-failure** — thesis was correct but execution drained the edge (slippage from skipping LV1, late exit despite TM1/TM2 firing, override of D2 guard with a loss)
   - **tilt** — entry was emotional rather than systematic: revenge-trade guard was bypassed, hot-streak sizing was over-applied, or no thesis was recorded
7. **Surface the lesson at the right layer**:
   - edge / variance → no action, just record the outcome alongside the thesis hash
   - thesis-failure → update or retire the ET1 thesis for that strategy id; the strategy needs a new economic-mechanism description
   - execution-failure → tighten the rule that was overridden (lower FTA threshold, shorter duration cap, escalate D2 to active mode for this strategy)
   - tilt → flag the operator-discipline failure pattern; consider enabling explain-first mode if not already on
8. **Append the structured observation** so ACE Reflector can distill the lesson across multiple postmortems.

## Tools used

- `get_trade_history` — pull the closed trade record
- `get_candles` — replay price action across the position lifetime
- `compute_brier_score` (SC1) — score probability predictions vs realized outcomes when present
- Structured observation log — pull the events that fired during the position
- Recorded thesis lookups (ET1 + recordUserThesis)
- `record_insight` / ACE Reflector input — append the classified postmortem

## What good output looks like

```
Trade: BTC long 2026-05-15 09:42 → 2026-05-15 14:18, P&L -1.4R
Strategy: regime-rsi-pullback (ET1 thesis recorded, hash a7f3...)

Thesis: passive momentum chasers buy after 3 consecutive green daily candles;
        the inefficiency is the late-arrival timing on the breakout.
At entry:
  - Regime: bull (confidence 0.72)
  - LV1: tradeable ($412K avg)
  - LV2: level was RECYCLED (3 touches in last 6h)  ← FLAG
  - D1: neutral_positive, no size-up
  - TM3: balanced

During lifetime:
  - TM1 FTA threshold (-0.5R) crossed at 10:18 — IGNORED
  - TM2 duration: 4.6h vs 1.8h avg winning → 2.5× normal — IGNORED

Classification: EXECUTION-FAILURE
  - Thesis was sound (LV2 recycled level was where the breakout should have failed back)
  - The recycled-level signal said this was mean-reversion territory, not momentum
  - The setup was misclassified at entry; should have been a SHORT, not a long
  - Plus: ignoring the FTA crossing turned a -0.5R loss into a -1.4R loss

Lessons:
  - Strategy needs an LV2 check at entry — if level is recycled, refuse the momentum direction
  - Re-evaluate ET1 thesis: "counterpartyIdentification" was wrong; not late-arrival momentum
    chasers, but exhausted momentum traders selling into recycled resistance
```

## Common failure modes

- Classifying everything as "variance" when the operator is uncomfortable looking at thesis or execution failures honestly
- Classifying every loss as "thesis-failure" when it was just variance within the expected distribution
- Confusing "thesis was wrong" with "thesis didn't apply this time" — single trades rarely invalidate theses; sequences do
- Skipping the structured-observation replay — without seeing what TM1/TM2/D2 actually said at the time, the classification is guesswork
- Updating the ET1 thesis after a single trade — wait for a pattern across 5+ trades before mutating the recorded thesis
