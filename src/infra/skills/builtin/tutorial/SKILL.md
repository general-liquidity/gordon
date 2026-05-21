---
name: tutorial
description: Interactive walkthrough — learn Gordon by doing. Scan, analyze, plan, and trade step by step. When user is new to Gordon, asks "how does this work?", "show me around", or "tutorial"
tags: [learning, onboarding, tutorial]
user-invocable: true
---

Welcome to Gordon! Let's learn by doing. I'll walk you through the core workflow.

## Step 1: See what's moving
First, let's scan the market. Run a quick scan to see what's trending and what has setups.

Show me trending tokens and top movers right now. Keep it brief — just the top 5.

## Step 2: Analyze a symbol
Pick the most interesting symbol from the scan results and run a quick analysis on it. Show me:
- Current price and 24h change
- Key support/resistance levels
- RSI and trend direction
- Whether there's a tradeable setup

## Step 3: Check risk
Before we even think about trading, let's check the risk profile. Run classify_trade_risk on a hypothetical $100 position in that symbol. Show me what the 11-dimension risk classifier says.

## Step 4: Show the permission system
Explain to the user how Gordon's permission modes work:
- `/ask` (default) — every trade requires approval via dialog
- `/auto` — trades execute without asking
- `/strict` — read-only, no trades at all

Tell them they're currently in whatever mode they're in, and that they can change it anytime.

## Step 5: Explore more
Now show the user what else they can do:
- `/marketplace` — browse 47 trading plugins
- `/cli` — see 8 trading CLIs they can install
- `/skills` — see available trading workflows
- `/model` — switch AI models
- `/help` — search all 135 commands

End with: "You're all set! Just tell me what you want to do — scan, analyze, trade, backtest, or anything else. I'll figure out the right tools."
