---
name: exit-review
description: Review all open positions — which to hold, trim, or close based on current conditions. When user says "review my positions", "what should I close?", "clean up my book", or wants to assess all open trades
tags: [review, exit, positions, cleanup]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Review every open position and give me an honest recommendation.

## For Each Position

Get all my open positions and for each one:

### 1. Current Status
- Symbol, side (long/short), entry price, current price
- Unrealized P&L ($ and %)
- How long held (days since entry)
- Stop loss and take profit levels (if set)

### 2. Technical Health
- Is the original setup still valid?
- Has the trend changed since entry?
- RSI: has it gone from oversold to overbought (or vice versa)?
- Is price near stop loss or take profit?

### 3. Risk Check
- Run tail risk on this position
- Has volatility increased since entry? (vol-percentile now vs at entry)
- Correlation with other positions (concentration risk)

### 4. Reluctance signal (TTRH / Klingson)

For each position, check how quickly it was logged after entry. Long latency between trade execution and the first post-trade journal entry is a soft signal the operator's gut already knew the trade was off-process — "if you felt reluctant to log it, you shouldn't have taken it."

For each position:
1. Get the trade's execution timestamp from the trade ledger (`ExecutionRecord.timestamp` for the matching planId / symbol).
2. Pull post-trade journal entries for the same symbol via `memory_search` (kind: market_observation, symbol: <ticker>, since: trade_execution_iso).
3. Score with `computeReluctanceScore({ tradeExecutedAtMs, journalEntryTimestampsMs })`.

Surface:
- `fast` (< 30m) — no action; clean workflow.
- `moderate` (30m–2h) — note the pattern; no immediate action.
- `slow` (2h–24h) — flag in the recommendation. Ask: "Did this trade fit your rules?"
- `very_slow` / `never` — strong reluctance signal. Add to the recommendation reasoning: this position may be a candidate for tighter management or earlier exit because the operator's own process-record suggests doubt at entry.

This is not a stop-loss criterion. It's a process-quality criterion that informs (but does not decide) the HOLD/TRIM/CLOSE/TIGHTEN recommendation.

### 5. Upstream vs downstream framing ("Go Upstream")

Before settling on a recommendation per position, ask yourself: **is this issue upstream or downstream?**

- **Upstream (setup-level)**: the original setup was wrong — wrong regime, wrong relative-strength read, wrong base structure, the thesis itself didn't hold. Fix: close the position and update the strategy rules / focus list / regime gate. A downstream patch (tighter stop, smaller size) doesn't address what caused the entry to be wrong.
- **Downstream (execution-level)**: the setup was correct but execution slipped — stop too wide, size too large, didn't take the planned trim, held through earnings against the rules. Fix: tighten / trim / cut, and update the trade ledger / journal with the execution lesson. The setup taxonomy stays intact.

State which category the issue falls into in the recommendation reasoning. If it's upstream and recurring (multiple positions with the same root cause), call that out — it's a strategy-level revision, not a per-position fix.

### 6. Recommendation
For each position, give ONE of:
- **HOLD** — setup intact, no reason to exit. Keep current stops.
- **TRIM** — take partial profits. Reduce by X%. Reason: [why]
- **CLOSE** — setup invalidated or target hit. Close entirely. Reason: [why]
- **TIGHTEN** — move stop loss to breakeven or trail closer. Reason: [why]

## Summary Table

Show all positions in one table:
```
Symbol  Side  Entry    Current  P&L     Days  Reluctance  Layer       Action   Reason
BTC     Long  $95,000  $97,500  +2.6%   5     fast        downstream  HOLD     Trend intact
ETH     Long  $3,800   $3,650   -3.9%   12    slow        upstream    TIGHTEN  Approaching stop; regime weakened post-entry
SOL     Long  $145     $138     -4.8%   8     never       upstream    CLOSE    Support broken; never logged → likely off-process
```

## Net Action
- Total positions: X
- Hold: X | Trim: X | Close: X | Tighten: X
- Estimated realized P&L from closures: $X
- Portfolio freed up: $X
- Upstream issues: X (consider strategy-level review if ≥ 2 share a root cause)
- Reluctance flags (slow / very_slow / never): X — write up the unlogged trades regardless of action

Ask: "Execute these recommendations?" (Only the closes and trims need approval)
