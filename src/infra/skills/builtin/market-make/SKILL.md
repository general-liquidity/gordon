---
name: market-make
description: Set up a market making strategy — place bid/ask quotes around mid-price to earn the spread. When user says "market make X", "provide liquidity on CEX", "earn the spread", or wants to set up bid/ask quotes
arguments: [symbol]
tags: [market-making, liquidity, spread, advanced]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Set up a market making strategy for {symbol}. This uses Hummingbot via MCP or manual order placement.

## Step 1: Pre-Checks
Before starting:
- Is {symbol} liquid enough? Check 24h volume — need at least $500K ADTV
- What's the current bid/ask spread? If spread < 0.05% on a major pair, market making is barely profitable
- What's the current volatility? High vol = wider spreads needed = more risk
- Run market efficiency tests — is the market mean-reverting (H < 0.5)? Market making works best in ranging markets

If Hurst > 0.6 (strong trend) → WARN: "Trending market — market making will accumulate inventory on the wrong side. Consider waiting for range-bound conditions."

## Step 2: Strategy Parameters
Determine the parameters:

### Spread
- **Bid spread**: how far below mid-price to place buy orders
- **Ask spread**: how far above mid-price to place sell orders
- Rule of thumb: spread ≥ 2× the exchange fee (e.g., if fee is 0.1%, min spread is 0.2%)
- In volatile conditions: widen spread by ATR multiplier
- Typical: 0.1% to 0.5% for major pairs, 0.5% to 2% for altcoins

### Order Size
- Per-order size: max 0.5% of portfolio per side
- Total inventory limit: max 5% of portfolio in this market making pair
- Use vol-percentile sizing to adjust

### Inventory Management
- **Target inventory**: 50/50 balance between base and quote asset
- **Inventory skew**: if holding too much of one side, widen that side's spread to discourage fills
- **Max inventory**: if inventory exceeds 3% of portfolio on one side, stop quoting that side

### Refresh Rate
- How often to cancel and replace orders
- Fast (every 10-30s): tighter spreads, more gas/fees
- Slow (every 1-5min): wider spreads, fewer fees
- Recommended: 30s for CEX, 2min for DEX

## Step 3: Risk Checks
- Run the 15-dimension risk classifier on the proposed strategy
- Check correlation with existing positions
- Verify trading constitution limits (max trades/hour, max position size)
- Set a kill switch: if P&L drops below -1% of allocated capital, stop the strategy

## Step 4: Execution Options

### Option A: Via Hummingbot MCP (Recommended)
If Hummingbot is connected via /mcp:
- Use Hummingbot's pure market making controller
- Set parameters: spread, order size, inventory skew, refresh rate
- Hummingbot handles order management, cancellation, and replacement
- Monitor via Gordon

### Option B: Manual via Gordon
If no Hummingbot:
- Place limit buy at mid - bid_spread
- Place limit sell at mid + ask_spread
- Set up HEARTBEAT.md to refresh every N seconds
- Monitor inventory balance and skew

## Step 5: Monitoring
Once running, monitor:
- Spread captured vs theoretical spread (slippage)
- Inventory balance (are we accumulating one side?)
- P&L (total spread earned minus inventory P&L)
- Fill rate (how often are orders getting filled?)

Show a compact dashboard:
```
MARKET MAKING: {symbol}
Spread: {bid}% / {ask}% | Mid: $X | Inventory: X base / Y quote
P&L: +$X (spread: +$Y, inventory: -$Z) | Fills: X/hr | Runtime: Xh
Status: ACTIVE | Kill switch: -1% ($X remaining)
```

## Step 6: When to Stop
- Spread compressed below profitable level → stop
- Volatility spike (ATR > 2× normal) → widen or stop
- Inventory skew > 70/30 → stop and rebalance
- Regime change to trending (Hurst > 0.6) → stop
- Kill switch hit → auto-stop
