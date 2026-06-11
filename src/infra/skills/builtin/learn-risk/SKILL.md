---
name: learn-risk
description: Learn how Gordon's 15-dimension risk classifier protects your capital. When user asks "how does risk work?", "what's the risk classifier?", "why did my trade get blocked?", or about capital protection
tags: [learning, risk, safety]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Let me explain how Gordon keeps your capital safe. Every trade goes through a 15-dimension risk check BEFORE execution — 8 base dimensions always scored, plus up to 7 optional when hedge-fund-grade inputs are available. No exceptions.

## The 8 Base Dimensions (always scored)

Explain each dimension clearly with a simple example:

1. **Position Size** — "Is this trade too large for my portfolio?"
   Example: $10K trade on a $50K portfolio = 20% (flagged)

2. **Concentration** — "Am I putting too much in one asset?"
   Example: Already have 15% in BTC, adding more pushes to 25% (flagged)

3. **Drawdown Proximity** — "Am I close to my loss limit?"
   Example: Daily loss at $800 of $1,000 limit — only $200 left

4. **Daily Loss Budget** — "Have I lost too much today?"

5. **Trade Frequency** — "Am I overtrading?"
   Example: 15 trades in the last hour (limit: 10)

6. **Volatility** — "Is the market calm or wild right now?"

7. **Market Hours** — "Am I trading after-hours (wider spreads)?"

8. **Asset Familiarity** — "Have I traded this before?"
   First-time trades get extra scrutiny.

## The 7 Optional Dimensions (when data is supplied)

9. **Vol-Adjusted Sizing** — "Where does current volatility sit historically?"
   If vol is at the 90th percentile, position automatically shrinks.

10. **Correlation Risk** — "Is this correlated with something I already hold?"
    BTC + ETH at 87% correlation = effectively doubling one bet.

11. **Venue MEV Exposure** — "Is this venue/DEX path exposed to sandwich or mempool risk?"

12. **Regime Transition Risk** — "Is the market regime shifting under this trade?"

13. **Fake Liquidity** — "Does the order book look manufactured or spoofed?"

14. **Margin of Error** — "Is the edge statistically meaningful after costs?"

15. **Tail Risk** — "Does this asset have fat tails (risk of sudden crashes)?"
    Measures skewness, kurtosis, max drawdown history.

## Risk Tiers

Explain what happens at each tier:
- **Low** (score 0-25): Auto-approved in `/auto` mode, quick approval in `/ask`
- **Medium** (score 25-50): Warning shown, user confirms
- **High** (score 50-75): Full risk assessment displayed, explicit confirmation required
- **Critical** (score 75-100): BLOCKED. Cannot execute. Must reduce size or change parameters.

## Try It

Offer to run a risk check on any symbol the user chooses: "Pick a symbol and a dollar amount, and I'll show you exactly what the classifier says."