---
name: weekend-review
description: Weekly performance review — P&L, lessons learned, and next week's plan
when_to_use: When user says "weekly review", "weekend recap", "plan next week", "this week's P&L", or wants weekly performance summary
tags: [review, weekly, performance, planning]
user-invocable: true
---

Run my weekly trading review. Be honest — don't sugarcoat results.

## Section 1: This Week's P&L
- Total realized P&L this week ($ and %)
- Total unrealized P&L change
- Best trade: symbol, entry, exit, P&L, what went right
- Worst trade: symbol, entry, exit, P&L, what went wrong
- Win rate this week
- Average R:R on winning vs losing trades

## Section 2: Pattern Analysis
Check the feedback loop data:
- Which patterns performed well this week? (confidence trending up)
- Which patterns underperformed? (confidence trending down)
- Any patterns on a losing streak (3+ consecutive losses)?
- Recommendation: lean into strong patterns, reduce exposure to weak ones

## Section 3: Risk Review
- Did I breach any risk limits this week?
- Maximum drawdown this week
- Was I properly sized? (Any trades too large for the volatility?)
- Correlation exposure: was I too concentrated?

## Section 4: Market Regime
- What was the dominant regime this week? (trending/ranging/volatile)
- Did it change mid-week?
- How does next week's regime look? (Markov transition probabilities)

## Section 5: Lessons Learned
Based on this week's trades, extract 2-3 specific lessons:
- What should I do MORE of?
- What should I STOP doing?
- What should I START doing?

Store these as session memory (durable facts for future sessions).

## Section 6: Next Week's Plan
- Key economic events / earnings coming up
- Watchlist: top 3-5 symbols with interesting setups
- Regime expectation: what strategy style fits?
- Risk budget: how much am I willing to risk next week?

End with: "Review complete. Lessons saved to memory. Have a good weekend."
