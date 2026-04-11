# Rebalance

Portfolio rebalancing workflow — adjust position weights back toward target allocations when drift, risk, or thesis change. Pairs with the `portfolio_drift` radar category and runs on demand when the user asks.

## When to use

- Radar fired `portfolio_drift` — a position exceeded 40% of portfolio or top-2 crossed 70%
- User adds a new position and wants to make room for it
- Regime flip across multiple held positions requires repositioning
- Monthly or quarterly scheduled rebalance
- After a big move in one holding that changed the weight materially

## The flow

1. **Snapshot current state** — positions, values, weights, realized + unrealized P&L per position
2. **Define targets** — equal-weight, market-cap-weighted, conviction-weighted, or user-specified
3. **Compute gaps** — for each position, how much to add or remove
4. **Order by impact** — trim the biggest overweight first (usually where the risk is), then size up underweights
5. **Simulate taxes / fees** — realized P&L triggers tax in taxable accounts; factor in if the user is trading a tax-aware account
6. **Build the trade plan** — list of buys and sells with sizes and preview slippage
7. **Risk check** — `check_risk` on each proposed trade
8. **Approval gate** — show the full plan before anything executes
9. **Execute in sequence** — sells first (to free capital), then buys; handle partial fills

## Tools used

- `get_portfolio`
- `position_size`
- `preview_market_order`
- `check_risk`
- `create_plan`
- `execute_plan`

## What good output looks like

- Current state table: position | value | weight | P&L
- Target state table: position | target weight | delta
- Trade list: action | symbol | size | approximate slippage
- Tax / realized P&L note if applicable
- Explicit approval prompt before execution

## Common failure modes

- Rebalancing too frequently — tax drag + fees eat the edge
- Ignoring correlations — trimming BTC and adding ETH doesn't reduce crypto exposure
- Not considering market impact on larger positions
- Skipping the risk check on individual legs
- Auto-executing without approval
