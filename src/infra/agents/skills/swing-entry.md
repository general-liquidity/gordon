# Swing Entry

Set up a swing trade with proper sizing, stop placement, and risk budget. This is the "commit to a trade" workflow — paired naturally after `/dd` and `/risk-check`.

## When to use

- User has done due diligence and wants to open a position
- User has a clear thesis and needs Gordon to handle the mechanics
- Swing horizon: hours to weeks (not scalps, not long-term holds)

## The flow

1. **Confirm the thesis** — restate what the user wants in one sentence before building anything
2. **Technical setup** — entry area, stop level (structural, not percent), first target, second target, invalidation
3. **Size the position** — `position_size` using the risk kernel limits, derive share/contract count from stop distance and the risk-per-trade cap
4. **Risk check** — `check_risk` with the proposed trade; BLOCK if it violates hard limits, WARN if it pushes a soft cap
5. **Build the plan** — `create_plan` with entry, stop, targets, and sizing
6. **Preview order** — `preview_market_order` or limit order preview so the user sees fees and slippage
7. **Approve step** — do NOT auto-execute; show the plan, ask for confirmation
8. **Record confidence** — call `record_confident_decision` with the thesis, stated confidence, and expected outcome so calibration tracking builds over time

## Tools used

- `create_plan`
- `position_size` / `kelly_size` / `volatility_adjusted_size`
- `check_risk`
- `preview_market_order` / `preview_limit_order`
- `record_confident_decision` (for calibration)
- `execute_plan` (only after explicit approval)

## What good output looks like

- Thesis restated in 1 sentence
- Entry scenario: specific level OR conditional ("if BTC holds $94k after retest")
- Stop: level + why that level (structural reason)
- Targets: first and second, with how much to scale
- Size: share/contract count + dollar risk + % of portfolio
- Risk verdict: PASS / WARN with details
- Explicit approval prompt before execution

## Common failure modes

- Skipping the risk check
- Using a percent stop instead of structural (gets run on noise)
- Over-sizing when the stop is close (percent-of-account risk trumps stop tightness)
- Auto-executing without explicit user confirmation
- Not recording the decision confidence (breaks the calibration loop)
