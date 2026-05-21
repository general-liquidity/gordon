---
name: learn-portfolio
description: Portfolio management tools — diff, sandbox, Black-Litterman, rebalancing, and checkpoints. When user asks "what portfolio tools?", "how do I rebalance?", "explain Black-Litterman", or about portfolio management
tags: [learning, portfolio, allocation, optimization]
user-invocable: true
---

Gordon has 5 portfolio-level tools that go beyond individual trades.

## 1. Portfolio Diff (Before/After Visualization)

See exactly what any change would do BEFORE executing:
- Position changes: added (green), removed (red), increased (▲), decreased (▼)
- Dollar impact per position
- Estimated fees
- P&L impact of closures
- Net cash change

Use: "Show me the diff if I sell all my ETH and buy SOL instead"

## 2. Strategy Sandbox (Paper Trading)

Test strategy variants without risking real money:
- Create isolated virtual portfolios with starting capital
- Simulate trades with realistic P&L tracking
- Compare multiple sandboxes side-by-side (return, drawdown, win rate)
- Promote the winner to live trading

Use: "Create a sandbox with $10K and test a momentum strategy on BTC"

## 3. Black-Litterman Portfolio Optimization

The gold standard for portfolio allocation:
- Starts with market-equilibrium weights (based on market cap)
- Overlay your VIEWS: "I think BTC will outperform by 5%"
- Bayesian math shifts allocation toward your views, weighted by your confidence
- Output: optimal weights that balance market wisdom + your conviction

Use: "Optimize my portfolio. I'm bullish on ETH (80% confidence) and bearish on SOL"

## 4. Auto-Rebalance (7-Step Pipeline)

Full rebalancing lifecycle:
1. **Detect drift** — are current weights far from targets?
2. **Compute target** — what should each weight be?
3. **Generate trades** — what buys/sells are needed?
4. **Risk check** — does the rebalance improve or worsen the risk profile?
5. **Approval** — user reviews the plan
6. **Execute** — trades placed (with atomic execution for multi-leg)
7. **Verify** — confirm fills, check new weights match targets

Use: `/rebalance` or "rebalance my portfolio to 40% BTC, 30% ETH, 30% SOL"

## 5. Strategy Checkpointing

Save portfolio snapshots at key moments:
- Before a major rebalance
- Before switching strategies
- Before earnings season
- Any time you want a "save point"

Later: compare checkpoints to see what changed and whether it helped.

Use: "Save a checkpoint before I rebalance" → "Compare with the checkpoint from last week"

## Portfolio Risk Tools

These work at the portfolio level (not individual positions):

### Correlation Matrix
- See how all your positions correlate
- If BTC + ETH + SOL are all >80% correlated → you effectively have one big bet

### Drawdown Overlay
- Scales ALL positions down when portfolio drawdown exceeds threshold
- Linear: 100% size at 5% DD → 0% size at 20% DD

### Volatility Targeting
- Scales positions so portfolio volatility stays at your target (e.g., 15% annual)
- If realized vol = 30% → positions automatically halved

## Try It
- "Show my portfolio with a diff of selling ETH"
- "Create a sandbox and paper trade for a week"
- "What's the Black-Litterman optimal allocation for my holdings?"
- `/rebalance` for the full workflow
