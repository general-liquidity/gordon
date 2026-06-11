# Exit Review

Review exit decisions on recent trades — was the exit early, late, or right on time? The purpose is learning, not second-guessing: use it to refine exit rules, not to beat yourself up about one specific trade.

## When to use

- After closing a position that either left money on the table or went against you
- Weekly as part of `/weekend-review`
- Fired by radar's `position_review` category on positions open 7+ days or after take-profit hits
- User asks "should I have held longer?" or "did I cut too late?"

## The flow

1. **Pick the scope** — specific trade by id, last N trades, or all trades in a date range
2. **Pull entry + exit data** — price, time, reason (stop / TP / manual / signal)
3. **Simulate alternative exits** — what if you'd held through the next structural level, or trailed 50% wider, or used a time stop at 3 days?
4. **Classify each exit**:
   - **optimal** — within 10% of the best alternative exit within the following 24-48h
   - **early** — left 25%+ on the table vs a reasonable hold
   - **late** — gave back 25%+ vs a reasonable earlier exit
   - **right reason, wrong timing** — the exit was triggered by a rule, but the rule itself was wrong for this regime
5. **Look for patterns** — are you systematically early on winners? Late on losers?
6. **Propose rule adjustments** — specific changes to stop placement, trailing logic, or time stops

## Tools used

- `get_trade_history`
- `get_candles` (for replay of price action after exit)
- `analyze_trade_exit_quality` (if available, otherwise simulate inline)
- `record_insight` (to log pattern findings)

## What good output looks like

Per trade:
- Entry → Exit → Alternative exits at 6h, 24h, next structural level, next signal flip
- Classification
- 1-sentence lesson

Aggregated:
- Pattern: "7 of the last 10 winners were closed within 20% of the eventual peak — you're leaving money on the table on winners"
- Proposed rule change: "On winners passing 2R, trail at 1.5x ATR instead of 1.0x"

## Common failure modes

- Cherry-picking the worst exits without acknowledging the good ones
- Using hindsight optimal as the benchmark (survivorship bias — alternative exits don't include ones where you would have been stopped out)
- Not distinguishing "right reason, wrong timing" from "wrong reason" — these need different fixes
- Proposing rule changes without backtesting them first — use `/research` to validate
