# Weekend Review

End-of-week performance review that turns a week of trades into actionable lessons. Runs Saturday or Sunday and produces a structured recap the user can act on before Monday's open.

## When to use

- Friday end-of-day or weekend
- Fired automatically by radar's `session_review` category when dayOfWeek=5 & hour>=21 UTC
- Manually via `/weekend-review`
- After a particularly bad or good week — both need review

## The flow

1. **Pull the week's trades** — `get_trade_history` filtered to the last 7 days
2. **Aggregate metrics** — win rate, total P&L, best trade, worst trade, average hold time, max drawdown during the week
3. **Attribute by strategy** — which playbooks performed, which didn't; if running multiple strategies, rank by risk-adjusted return
4. **Attribute by symbol** — best and worst tickers
5. **Surface patterns** — cluster losses (time of day, regime, setup type); cluster wins
6. **Calibration check** — call `get_calibration_stats` filtered to entry_call and exit_call domains; flag overconfidence if any bucket's accuracy is >10pp below stated confidence
7. **Radar retrospective** — `get_proactive_stats` to show MN/CD/FA/NR counts for the week; flag noisy categories
8. **Propose adjustments** — specific, not vague. "Tighten scalp entries on BTC below 60 RSI" not "be more disciplined"
9. **Log to memory** — `record_insight` with the week's takeaways so future sessions can reference them

## Tools used

- `get_trade_history`
- `get_portfolio`
- `get_trade_statistics`
- `get_backtest_journal_stats`
- `get_calibration_stats`
- `get_proactive_stats`
- `analyze_drawdown`
- `record_insight`

## What good output looks like

Four sections:
1. **Numbers** — P&L, win rate, trade count, max DD, best/worst trade
2. **Attribution** — strategy-level and symbol-level breakdown
3. **Patterns** — clusters of wins and losses with the factor they share
4. **Adjustments** — 2-3 specific changes for next week, each with its rationale

Avoid fluff. The user wants to know what to change, not how great they are.

## Common failure modes

- Reading only headline P&L and ignoring attribution
- Vague adjustments ("be more patient")
- Not checking calibration — overconfidence is the silent killer of trader accounts
- Ignoring the wins — winning patterns need reinforcement, not just losing ones need fixing
- Comparing to last week's baseline without context (last week's conditions matter)
