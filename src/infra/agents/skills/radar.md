# Radar (Proactive Mode)

Proactive suggestion mode — Gordon watches market events, portfolio state, the regime detector, RSS/news headlines, and periodic ticks, and surfaces unsolicited suggestions when conditions warrant. Default posture is silence; only propose when confident the suggestion is worth interrupting the user.

## When to use

- Extended trading sessions where you want Gordon watching while you work on something else
- Active portfolio where risk conditions can shift fast
- Users who prefer to be alerted rather than continuously poll Gordon manually
- Pairs well with autonomous mode — radar flags things humans need to decide; autonomous loop handles pre-approved executions

## The flow

When radar is active and a producer fires a candidate:
1. **Observation lands** — event bus emits trade:closed, scan:opportunity, risk:rejected, regime tick, etc.
2. **Producer generates candidate** — 21 registered producers match observations to categories (regime_flip, chart_pattern, whale_alert, volatility_spike, stop_loss_tighten, portfolio_drift, missed_entry, position_review, journal_prompt, session_review, risk_warning, playbook_suggest, funding_alert, news_event, earnings_approaching, insider_flow_alert, analyst_upgrade, congressional_trade)
3. **Judge evaluates** — heuristic (default) or LLM judge checks policy, cooldowns, duplicates, relevance, confidence threshold
4. **Fire or drop** — passing candidates land in the store, event bus emits proactive:suggestion_fired, TUI chat shows the card
5. **User responds** — /ack (Correct-Detection), /pass (False-Alarm), /snooze <category> [minutes]
6. **Feedback shapes future firing** — 3+ passes in an hour auto-suppresses the category, acceptance rates tune thresholds

## Slash commands

- `/radar on` — activate, loads persisted state, wires producers and event subscribers
- `/radar off` — deactivate, saves state, tears down observer
- `/radar status` — running state, counts, producer health
- `/radar tune` — precision / recall / F1 stats per category
- `/ack <id>` — accept a suggestion (auto-invokes read-only operations if present)
- `/pass <id>` — dismiss
- `/snooze <category> [minutes]` — silence a category
- `/learn-radar` — this document

## Categories

Crypto-focused:
- `regime_flip` — BTC/ETH/SOL regime transition detected
- `chart_pattern` — geometric chart pattern (LMW) completed on a watched symbol
- `whale_alert` — RSS headline keywords for whale-scale flows (large transfers, accumulation, dormant-wallet moves) on monitored symbols
- `volatility_spike` — ATR expansion > 1.5x baseline
- `stop_loss_tighten` — price approaching stop < 2%
- `portfolio_drift` — single position > 40% or top-2 > 70% of portfolio
- `missed_entry` — scanner found high-confidence setup (> 0.70)
- `position_review` — position open 7+ days, or take-profit hit (runner management)
- `funding_alert` — perp funding rate anomaly

Stock-focused:
- `earnings_approaching` — upcoming earnings within N days
- `insider_flow_alert` — cluster of insider transactions
- `analyst_upgrade` — consensus rating shift toward bullish
- `congressional_trade` — STOCK Act disclosure on held or watched symbol

General:
- `journal_prompt` — periodic journaling nudge
- `session_review` — end of day / end of week
- `risk_warning` — risk_rejected event or mandate breached
- `playbook_suggest` — new regime-matched playbook available
- `news_event` — significant news on held positions (crypto RSS or stock RSS/EDGAR via stockNewsEvent producer)

## Category policy

Each category has defaults: cooldown, minimum confidence, max per hour. Auto-suppression triggers on 3+ passes in an hour. Tune via `configure_proactive_category`.

## Output format

When judging a candidate, reason through:
- **Purpose**: what the user is likely doing right now
- **Thoughts**: why this event might or might not warrant firing
- **Proactive_Task**: null if no, otherwise the specific suggestion
- **Category**: one of the categories above
- **Confidence**: 0..1, must meet category minimum

## Rules

- Default is silence — set Proactive_Task to null when in doubt
- Never re-propose duplicates within cooldown
- Respect snoozed categories completely
- Feedback-shape: if dismissals outnumber accepts, raise your threshold
- Suggestions are advice, not commands
- Accepted read-only operations (`get_portfolio`, `detect_market_regime`) can auto-invoke; write operations need explicit user approval