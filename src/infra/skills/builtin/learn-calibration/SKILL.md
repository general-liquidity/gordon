---
name: learn-calibration
description: Gordon's confidence calibration system — track whether your stated confidence matches actual accuracy. When user asks about calibration, decision tracking, confidence stats, or "when I say X% confident, how often am I right?"
tags: [learning, calibration, confidence, decision-quality]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Calibration measures the gap between your *stated* confidence and your *actual* accuracy. When you say "80% confident," are you right 80% of the time? Most traders are overconfident at the high end and underconfident at the low end. Calibration makes this visible over hundreds of decisions.

## The Loop (3 Steps)

### Step 1: Record the decision **before** the outcome is known

```
record_confident_decision
  symbol: BTCUSDT
  action: "long entry at 68400"
  confidence: 75
  domain: entry_call
  rationale: "CHoCH confirmed + FVG at 68200 + rising OBV"
```

**Critical**: confidence must be recorded at decision time, not after. Recording after you know the outcome is hindsight, not calibration.

### Step 2: Record the outcome when it's known

```
record_decision_outcome
  decisionId: dec_abc123
  result: correct    # or: wrong / partial / unknown
  details: "Hit TP at 69200 two hours later"
```

### Step 3: Check your stats periodically

```
get_calibration_stats
```

Returns precision per confidence bucket:
```
60-70%: 18 decisions, 12 correct → actual 66.7% (well-calibrated)
70-80%: 25 decisions, 14 correct → actual 56.0% (overconfident by 19%)
80-90%: 11 decisions,  9 correct → actual 81.8% (well-calibrated)
90-100%: 5 decisions,  5 correct → actual 100% (well-calibrated)
```

The 70-80% bucket is the tell: you're claiming 75% confidence but hitting 56%. Either tighten the criteria for a 75% call or move those setups to a lower bucket.

## Decision Domains

Tag each decision with a domain so you can see per-domain calibration:
- **proactive_suggestion**: confidence in radar suggestions you ack'd
- **strategy_pick**: confidence in a strategy you deployed
- **entry_call**: confidence in an individual trade entry
- **exit_call**: confidence in an exit decision
- **verdict_screen**: confidence in a backtest verdict being live-worthy
- **risk_assessment**: confidence in a risk classification
- **regime_classification**: confidence in current market regime
- **custom**: whatever else you want to track

Per-domain breakdown often reveals that you're well-calibrated on regime calls but overconfident on entries (or vice versa).

## Calibration Error

The overall calibration error is the mean absolute distance between bucket midpoint and actual accuracy. Lower is better.
- **< 5%**: excellent calibration (rare)
- **5–10%**: well-calibrated (target)
- **10–20%**: typical retail trader
- **> 20%**: needs attention — either confidence claims are noise, or criteria need tightening

## Why This Matters

Overconfidence is the single biggest cognitive hazard in discretionary trading. When you say "I'm 85% sure this goes up" and you're only right 60% of the time, you size too big. Calibration catches this over sample sizes large enough that hindsight bias can't hide it.

Gordon uses calibration to:
1. Weight your stated confidence by your historical accuracy (in radar judge decisions)
2. Surface calibration warnings before high-confidence trades in weak buckets
3. Improve verdict screening — a backtest that says "85% Sharpe > 1.5" gets weighted by your 85%-bucket accuracy

## Common Patterns

**The overconfidence cliff**: 90% confidence bucket shows 70% actual accuracy. Usually means you're promoting 75% setups to 90% out of eagerness. Fix by requiring explicit checklist criteria for 90%+ claims.

**The "everything is 70%" bias**: 70% bucket dominates your history because you're hedging. Calibration will show it's neither overconfident nor underconfident — which is fine, but you're leaving signal on the table. Practice making 50% and 90% calls to spread your distribution.

**Domain drift**: entry_calls drift overconfident during winning streaks. Regime_classifications drift underconfident after a surprise reversal. Check monthly to catch drift before it compounds.

## Commands

- **record_confident_decision**: log a decision with stated confidence at decision time
- **record_decision_outcome**: pair an outcome to a prior decision
- **get_calibration_stats**: precision/recall by bucket, per-domain breakdown, calibration error
- **list_recent_decisions**: inspect the decision log, find unresolved decisions

## Persistence

All decisions persist at `~/.gordon/calibration.jsonl` as newline-delimited JSON. Back this file up — it's years of calibration signal that can't be reconstructed after the fact.
