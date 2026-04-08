---
name: arb-funding
description: Funding rate arbitrage — earn funding payments by going long spot + short perps (or vice versa)
when_to_use: When user asks about funding rate arbitrage, basis trade, cash-and-carry, or earning yield from perps
arguments: [symbol]
tags: [arbitrage, funding, perps, yield, advanced]
user-invocable: true
---

Analyze and set up a funding rate arbitrage for {symbol}.

## What is Funding Rate Arbitrage?

Perpetual futures pay/receive a "funding rate" every 8 hours. When funding is positive (longs pay shorts), you can:
- Go LONG spot (buy the actual asset)
- Go SHORT perps (sell the perpetual future)
- Collect funding payments from shorts while being market-neutral

This is a delta-neutral strategy — you don't care about price direction. You earn the spread between spot and perps.

## Step 1: Check Funding Rate
- Current funding rate for {symbol} perps
- Annualized yield: funding_rate × 3 × 365 (3 payments/day × 365 days)
- Historical average funding rate (last 30 days)
- Is it consistently positive or negative?

If annualized yield < 5% → "Funding rate too low for profitable arb after fees. Wait for elevated funding."
If funding rate is negative → "Reverse the trade: short spot (if possible), long perps."

## Step 2: Cost Analysis
Calculate all-in costs:
- Spot trading fee (buy)
- Perps trading fee (open short)
- Perps maker/taker fee per funding period
- Estimated slippage on both legs
- Borrowing cost (if shorting spot via margin)
- Total cost per cycle (8h)

Net yield = funding received - total costs

If net yield < 0 → STOP. "Costs exceed funding. Not profitable."

## Step 3: Position Sizing
- Must be EQUAL notional on both legs (delta neutral)
- Max position: per trading constitution limits
- Account for margin requirements on the perps side
- Leave buffer for mark-to-market movements (positions may diverge temporarily)

## Step 4: Execution
Both legs must execute simultaneously (or as close as possible):

### Leg 1: Buy spot
- Market or limit order on spot exchange
- Size: $X notional

### Leg 2: Short perps
- Open short perpetual at same notional
- Set to same size as spot leg
- Leverage: 1x (fully collateralized) — do NOT use leverage for arb

### Atomic Execution
Use Gordon's atomic execution module:
- Both legs succeed or both get cancelled
- If one leg fails, rollback the other
- No naked short/long exposure

## Step 5: Monitoring
Track continuously:
- Funding payments received (accumulating)
- Basis (spot price vs perps price) — should stay close
- Unrealized P&L on each leg (should roughly cancel)
- Net P&L = funding collected - fees - basis divergence

Alert conditions:
- Basis diverges > 1% → warn (temporary divergence is normal, sustained is not)
- Funding rate flips sign → consider unwinding
- One leg gets liquidated → EMERGENCY — close other leg immediately

## Step 6: When to Unwind
- Funding rate drops below breakeven threshold
- Funding rate flips negative for 3+ consecutive periods
- Better opportunity elsewhere
- Target yield reached (e.g., earned 2% in a week)

Unwind: close both legs simultaneously (atomic).

## Summary Display
```
FUNDING ARB: {symbol}
Spot: LONG $X @ $Y | Perps: SHORT $X @ $Z
Funding rate: +0.03% / 8h (annualized ~33%)
Net yield after fees: ~28% annualized
Basis: 0.12% | Duration: 3 days | Collected: $X
Status: ACTIVE | Next funding: 2h 15m
```
