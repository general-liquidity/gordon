---
name: close-losers
description: Review and close losing positions that have hit stop levels. When user says "review my losers", "cut losses", "kill the bleeders", "close underperformers", or wants to trim positions in drawdown
tags: [execution, risk, cleanup]
user-invocable: true
context: inline
status: active
last-reviewed: 2026-05-23
---

Review all my open positions and identify losers:

1. **Find losing positions**: Which positions are currently in the red?
2. **Check stop levels**: Which have hit or are near their stop loss?
3. **Rank by urgency**: Worst performers first
4. **Propose closures**: For each loser at or past stop loss, propose closing it

Show me the list and let me approve each closure. Don't close anything without my explicit approval.
