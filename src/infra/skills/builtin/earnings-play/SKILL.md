---
name: earnings-play
description: Pre-earnings analysis — fundamentals, historical moves, implied volatility, and trade plan
when_to_use: When user wants to trade around earnings, check earnings dates, or analyze pre-earnings setup
arguments: [symbol]
tags: [earnings, fundamentals, event, stocks]
user-invocable: true
---

Run a complete pre-earnings analysis for {symbol}.

## Step 1: Earnings Date
- When is the next earnings report? (date and time)
- Is it before market open or after close?
- How many days until earnings?

## Step 2: Fundamental Snapshot
Get current fundamentals:
- Revenue (TTM) and growth rate
- EPS (TTM) and growth rate
- P/E ratio vs sector average
- Profit margins (gross, operating, net)
- Free cash flow
- Analyst consensus: beat/miss expectations last 4 quarters?

## Step 3: Scenario Valuation
Run bear/base/bull DCF:
- Bear case: what if revenue drops 5%?
- Base case: consensus estimates
- Bull case: what if revenue beats by 10%?
- Weighted fair value vs current price
- Is the stock undervalued or overvalued going into earnings?

## Step 4: Historical Earnings Moves
Look at the last 4-8 earnings reports:
- Average move on earnings day (%)
- Largest positive move
- Largest negative move
- Beat rate (how often does the company beat estimates?)

## Step 5: Technical Setup
- Current price relative to key levels
- Is the stock near support or resistance going into earnings?
- Volume trend leading into earnings (accumulation or distribution?)
- RSI: is it overbought/oversold?

## Step 6: Risk Assessment
Run risk classifier with emphasis on:
- Event risk (earnings = binary outcome)
- Tail risk (earnings can cause 10%+ moves)
- Position sizing should be SMALLER than normal (event risk)

## Step 7: Trade Plan
Three options:
A) **Pre-earnings momentum**: Enter before earnings if there's a clear trend
B) **Post-earnings reaction**: Wait for the report, trade the reaction
C) **No trade**: If risk/reward doesn't make sense, skip it

For each option, show: entry, stop, target, size, R:R.

Recommend one option with reasoning.
