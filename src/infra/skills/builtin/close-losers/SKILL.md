---
name: close-losers
description: Review and close losing positions that have hit stop levels
when_to_use: When user wants to cut losses on underperforming positions
tags: [execution, risk, cleanup]
user-invocable: true
context: inline
---

Review all my open positions and identify losers:

1. **Find losing positions**: Which positions are currently in the red?
2. **Check stop levels**: Which have hit or are near their stop loss?
3. **Rank by urgency**: Worst performers first
4. **Propose closures**: For each loser at or past stop loss, propose closing it

Show me the list and let me approve each closure. Don't close anything without my explicit approval.
