---
name: rebalance
description: Portfolio rebalance workflow — check drift, compute target allocation, execute
when_to_use: When user says "rebalance my portfolio", "check drift", "adjust weights", "rebalance to target", or wants portfolio rebalancing
tags: [portfolio, rebalance, allocation]
user-invocable: true
---

Run the full rebalance workflow on my portfolio.

## Step 1: Current Allocation
Show my current portfolio:
- Each position: symbol, quantity, current value, weight %
- Total portfolio value
- Cash available
- Current allocation pie (as a text summary)

## Step 2: Drift Detection
Compare current weights to target allocation (ask user for targets if not set).
- For each position: current weight vs target weight
- Absolute drift per position
- Total portfolio drift (sum of absolute deviations)
- If total drift < 5% → "Portfolio is balanced. No action needed."

## Step 3: Correlation Check
Before rebalancing, check if the target allocation creates concentration risk:
- Run correlation matrix across all positions
- Flag any pair with |correlation| > 0.7
- Suggest adjustments if correlated positions would exceed 30% combined

## Step 4: Rebalance Trades
For each position that needs adjustment:
- Current weight → target weight
- Dollar amount to buy or sell
- Estimated fees
- Estimated tax impact (if positions have unrealized gains)

Show as a portfolio diff (red/green changes).

## Step 5: Risk Assessment
Run risk classifier on the rebalance as a whole:
- Does the new allocation improve or worsen the risk profile?
- Check tail risk of the proposed portfolio
- Drawdown overlay: should we scale down given current conditions?

## Step 6: Save Checkpoint
Save a portfolio checkpoint BEFORE executing (so we can compare before/after).

## Step 7: Execute or Defer
Show the complete rebalance plan:
- Trades to execute (sorted by size)
- Total estimated fees
- Net cash change
- Expected new weights

Ask: "Execute all rebalance trades?" or "Defer to later?"
