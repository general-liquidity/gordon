---
name: liquidity-provide
description: Provide liquidity to a DEX pool — analyze pool, calculate impermanent loss risk, deposit, and monitor. When user says "LP on X", "provide liquidity to pool", "earn DEX fees", or wants to manage an LP position with IL tracking
arguments: [pool]
tags: [liquidity, defi, pool, yield, advanced]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Analyze and manage a liquidity provision for {pool}.

## Step 1: Pool Analysis
Get pool details:
- DEX and chain (any AMM — fetch pool metadata via onchain data sources)
- Token pair and current prices
- Pool TVL (total value locked)
- 24h volume and fees generated
- Fee tier (0.01%, 0.05%, 0.3%, 1%)
- Current APR from fees
- Any additional reward tokens?

## Step 2: Impermanent Loss Assessment
Calculate potential IL for different price scenarios:
- If token A goes up 25% vs token B → IL = ?
- If token A goes up 50% → IL = ?
- If token A goes up 100% → IL = ?
- If token A goes DOWN 25% → IL = ?
- If token A goes DOWN 50% → IL = ?

Show the break-even: "Fees need to exceed X% over Y days to compensate for IL at current volatility."

Check correlation between the two tokens:
- High correlation (>0.8) → low IL risk (they move together)
- Low correlation → high IL risk
- Stablecoin pair → minimal IL

## Step 3: Concentration Assessment (if concentrated liquidity)
For concentrated-liquidity AMMs (V3-style / Whirlpool-style):
- Current price vs your range
- What price range to set?
  - Narrow range: higher fees per dollar, but more IL and frequent rebalancing
  - Wide range: lower fees per dollar, but less IL and less maintenance
- Recommended: set range at ±1 standard deviation of 30-day price range
- How often will price go out of range? (based on historical volatility)

## Step 4: Risk Checks
- Run tail risk on both tokens
- Check DeFi-specific constitution limits:
  - Max single protocol: 10% of portfolio
  - Max total DeFi: 30%
  - Unaudited contracts: max 2%
  - New tokens (<30 days): max 1%
- Is the smart contract audited?
- Rug pull risk assessment (if available)

## Step 5: Position Sizing
- Calculate optimal LP size using vol-percentile sizing
- Apply drawdown overlay
- Factor in IL as additional risk
- Recommended: start with 50% of calculated size, add more after 1 week if fees meet expectations

## Step 6: Deposit (external only)
Gordon has no native on-chain LP execution kit. If the operator wants to deposit:
- Use an external wallet, MCP plugin, or CLI from `/marketplace` or `/cli`
- Document the intended range, size, and both token amounts in the plan
- Do not call nonexistent Gordon tools to approve or confirm chain transactions

## Step 7: Monitoring
Track ongoing performance:
- Fees earned (cumulative)
- Impermanent loss (cumulative)
- Net P&L = fees - IL
- APR (rolling 7-day)
- Is price still in range? (concentrated only)
- Pool TVL change (others joining/leaving)

Set up alerts:
- Price exits range → notify for rebalance
- IL exceeds fees → warn
- Pool TVL drops > 30% → warn (potential rug or migration)
- APR drops below threshold → consider withdrawal

## Display
```
LP POSITION: {pool}
Deposited: $X ($Y token A + $Z token B)
Fees earned: +$X (APR: X%)
Impermanent loss: -$X
Net P&L: +/-$X
Range: $A - $B (currently IN range)
Duration: X days | Break-even: Y more days at current APR
```

## When to Exit
- Fees < IL for 7+ consecutive days
- Price permanently moved out of range
- Better opportunity elsewhere (higher APR, lower IL)
- Pool TVL collapsing
- Protocol risk event (hack, exploit, governance attack)

Withdraw: remove liquidity, collect fees, swap back to desired assets if needed.
