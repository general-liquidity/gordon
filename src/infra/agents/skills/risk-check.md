# Risk Check

Run a risk assessment on the user's current portfolio or a proposed trade idea. Grounds every decision against the trading constitution's 11-dimension risk classifier.

## When to use

- Before placing a trade — called by `/swing-entry` flow automatically
- User asks "is this safe?" or "am I overexposed?"
- After a losing streak — forces review instead of impulse revenge trades
- Portfolio drift detected by radar — risk_warning or portfolio_drift category

## The flow

1. **Gather context** — current positions via `get_portfolio`, recent trades via `get_trade_history`, session P&L
2. **Classify the trade or portfolio** — call `classify_trade_risk` (11 dimensions: concentration, correlation, drawdown sensitivity, liquidity, tail risk, leverage, cascade risk, regime fit, time-of-day, news risk, technical fit)
3. **Check hard limits** — per the constitution: daily loss cap, max drawdown, max open positions, max position size
4. **Check soft warnings** — circuit breakers approaching, consecutive losses, correlation clusters
5. **Return a verdict** — PASS / WARN / BLOCK with specific dimensions that failed

## Tools used

- `classify_trade_risk` — 11-dimension risk classifier
- `check_risk` — enforce constitution rules
- `check_daily_limit`
- `check_positions`
- `get_portfolio`
- `assess_drawdown_risk`

## What good output looks like

- Clear verdict (PASS / WARN / BLOCK) on top
- List of the specific dimensions that contributed to the verdict
- Actionable remediation for each issue ("reduce size to N", "add hedge on X", "wait for regime confirmation")
- No generic "looks risky" — be specific about which rule and by how much

## Common failure modes

- Only checking monetary limits and ignoring structural risk (correlation, regime mismatch)
- Passing a trade that violates a soft rule just because it doesn't hit a hard cap
- Being vague — "some concentration risk" instead of "BTC would become 42% of portfolio, exceeding 30% soft cap by 12 points"
- Not considering the user's recent performance — a loss streak should make the gate tighter
