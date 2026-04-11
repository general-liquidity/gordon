# Morning Brief

Market overview and overnight summary when the user starts a new trading session. The 60-second read that sets up the day without boiling the ocean.

## When to use

- User's first interaction of the day
- After a long break
- Session start keybind / slash command
- Explicitly: "what's going on right now?"

## The flow

1. **Session state** — what positions are open, overnight P&L, any fills while the user was away
2. **Overnight narrative** — macro news (via `get_economic_calendar` and `get_news_sentiment` for key tickers), crypto overnight (if held)
3. **Regime scan** — BTC/ETH regime check, SPX/QQQ regime check (if stocks held), any regime transitions overnight
4. **Radar review** — check `list_proactive_suggestions` for pending items that fired while away
5. **Key levels** — for held positions, update where the important technicals are now
6. **Today's agenda** — upcoming earnings from `get_upcoming_earnings`, major economic releases, any scheduled autonomous mode wake-ups

## Tools used

- `get_portfolio` / `check_positions`
- `get_trade_history` (filter to last 24h)
- `get_economic_calendar`
- `get_upcoming_earnings`
- `detect_market_regime` (BTC/ETH + SPX/QQQ if relevant)
- `list_proactive_suggestions` (pending + recently dismissed)
- `analyze_x_narrative` (for held positions)

## What good output looks like

Three sections, compact:
1. **Portfolio state**: held, P&L, fills overnight (if any)
2. **Market state**: regimes, key macro events, anything that matters for held positions
3. **Today**: upcoming earnings, releases, scheduled events, pending radar suggestions

No filler. If nothing happened overnight, say so. Don't invent narrative to fill space.

## Common failure modes

- Reading every ticker in the world instead of just what the user holds or watches
- Burying the lede — overnight fills should be the first thing, not buried in a narrative
- Not mentioning radar suggestions that fired while away — they're literally designed for this moment
- Repeating the same macro news every day — flag only what's new since yesterday's brief
