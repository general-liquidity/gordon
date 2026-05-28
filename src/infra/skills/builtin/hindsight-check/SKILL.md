---
name: hindsight-check
description: "Classify a proposed post-trade rule change as legitimate execution-review OR hindsight-desire rewriting rules. When user says /hindsight-check, 'should I change my system based on this trade?', 'I wish I'd held longer — should that be a rule?', 'I want to add a new filter after this loss' — pull the plan + synthesis manifest + audit chain for the trade in question, then test whether the proposed rule was already present at plan creation. If yes, this is legitimate (execution failed against an existing rule). If no, the rule did not exist when the trade was placed and the version of you who knows the outcome is rewriting the system. Do not change rules from hindsight desire."
arguments: [planId|symbol]
argument-hint: Plan ID (preferred) or symbol of the trade under review. The operator must also state the proposed rule change in natural language.
tags: [review, retrospective, hindsight-bias, system-discipline]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Run the hindsight check on a closed (or about-to-be-closed) trade and a proposed rule change. The framing from the source article: **"the version of you who knows the result judges the version of you who didn't."** That second-you has an unfair advantage and an unfair authority — the system was built by the first-you, who didn't know the outcome, and changing it from the second-you's perspective is how rules get rewritten by results instead of by process.

This is a pure-composition skill. No new tools. It reads the existing plan + synthesis manifest + audit chain + journal entries via `memory_search` and `audit_event` lookups, then classifies the proposed change.

## Step 1: Anchor the trade

Get the plan and execution record:

```
memory_search({ kind: 'plan', symbol: <symbol>, limit: 5 })
// or filter on planId directly if provided
```

Pull:
- `plan.rationale` (the operator's stated reasons for entering)
- `plan.entryPrice` / `plan.stopLossPrice` / `plan.sizeUsd` (the decision-time risk shape)
- `plan.routingPolicy`
- `plan.timeHorizonHours`
- `synthesisManifest` (the system + indicator state at decision time, if recorded)

If no plan or manifest is recoverable, the trade was off-process — STOP. Tell the operator: "I can't run a hindsight check on a trade without a recorded plan. The honest read is the trade was discretionary and the proposed rule wouldn't have applied either way."

## Step 2: Pull the decision-time context

The "version of you who didn't know" lives in the audit chain at trade-creation time. Get it:

```
memory_search({ kind: 'market_observation', symbol: <symbol>, since: <plan.createdAt - 24h>, until: <plan.createdAt> })
```

This surfaces what the operator + the agent observed in the 24 hours before plan creation — the indicator readings, regime classification, news context. This is the substrate the rule-set was applied against.

Also pull the audit events written around plan creation:

```
audit_event lookups for: plan.created, plan.verified, plan.approved (same planId)
```

Specifically the `rationale_recorded` events for `create_plan` / `approve_plan` — these contain the decision-time intent in the operator's own words.

## Step 3: Pull the outcome

```
memory_search({ kind: 'market_observation', symbol: <symbol>, since: <plan.createdAt>, until: now })
memory_search({ kind: 'trade_execution', symbol: <symbol>, since: <plan.createdAt> })
```

Get the realized P&L, exit timing, what happened after entry. This is the "version who knows the result."

## Step 4: Classify the proposed rule

The operator states a proposed change. Examples:
- "I should add a rule: never enter on Fridays."
- "I should require ADX > 25 for momentum entries."
- "I should trim 50% at 2R instead of 25%."
- "I should never short during NFP week."

For each proposed rule, test these in order:

**(a) Was the rule already in the rationale or synthesis manifest at creation?**
Grep `plan.rationale` + `synthesisManifest` + the pre-trade audit events for the rule's components. If the rule was present and the operator violated it, the trade was an **execution failure against an existing rule** — legitimate to review the execution, not the rule. Output: `EXECUTION_REVIEW`.

**(b) Was the rule's signal present in the decision-time context but not acted on?**
E.g. operator proposes "ADX > 25 for momentum" — check if ADX < 25 was visible in the pre-trade market_observations but ignored. If yes, this is a **signal that was there but unweighted** — adding it to the rule set is legitimate IF (and only if) the operator can show the signal was also present on prior winning trades and the proposed rule would have kept them. (Confirmation-bias check — see Step 5.) Output: `SIGNAL_PROMOTION_CANDIDATE`.

**(c) Is the rule only motivated by the outcome?**
If the proposed rule was NOT in the rationale, NOT in the synthesis manifest, and the decision-time context did NOT contain the signal — then the rule is being constructed from the outcome alone. The "version of you who knows the result" invented it. Output: `HINDSIGHT_DESIRE`. Do not promote to a rule. Tell the operator explicitly: this is the article's failure mode, and the honest answer is the system held no view on this dimension at decision time.

**(d) Is the proposed rule "do the trade I wished I'd done"?**
Patterns like "I wish I'd held longer" / "I wish I'd taken a bigger size" / "I should add a rule to ride winners further." These are almost always `HINDSIGHT_DESIRE` because they would change behavior on the winning tail without changing behavior on the losing tail. Test: would the proposed rule have **lost more on losing trades**? If the operator can't or won't answer that question with data, classify as `HINDSIGHT_DESIRE`.

## Step 5: Confirmation-bias cross-check

For any `SIGNAL_PROMOTION_CANDIDATE`, before promoting:

```
memory_search({ kind: 'plan', tags: ['<relevant strategy tag>'], since: <90d ago>, limit: 50 })
```

Walk through the last N trades on the same strategy:
1. How many were winners? How many losers?
2. On how many was the proposed signal present?
3. Of trades where the signal was present, what was the win-rate? Of trades where it was absent, what was the win-rate?
4. Would adopting the rule keep more winners than it cuts?

If the signal correlates with wins by more than chance (informal threshold: ≥ 5 trades in each bucket, ≥ 10pt win-rate gap), this is a real signal — promote to a rule. Otherwise, decline — the proposed rule is overfit to this one trade. Output: `OVERFIT_TO_SINGLE_TRADE`.

## Step 6: Output verdict + audit

Tell the operator one of four verdicts:

- **EXECUTION_REVIEW** — "The rule already existed in your rationale at entry. You violated it. The review is about execution, not the rule. Don't change the system; check why you overrode it."
- **SIGNAL_PROMOTION_CANDIDATE → confirmation-bias check passed** — "The proposed signal was visible at decision time and the historical data on the last N trades supports promoting it. Propose the rule formally for your next system update."
- **OVERFIT_TO_SINGLE_TRADE** — "The signal was there but the historical pattern doesn't support it. You're rewriting the system from one trade. Decline."
- **HINDSIGHT_DESIRE** — "The rule did not exist at entry and the signal was not present in the decision-time context. The version of you who knows the result invented it. Do not promote. The honest read is the system held no view on this dimension; that's fine, not every dimension needs a rule."

Then write the audit + memory:

```
audit_event({
  action: 'OBSERVATION',
  summary: 'hindsight-check on <symbol> (plan <planId>): verdict <VERDICT>',
  parameters: { planId, symbol, proposed_rule, verdict, signal_present_at_decision, historical_winrate_with_signal, historical_winrate_without }
})
memory_write({
  kind: 'observation',
  content: 'Hindsight check: <verdict>. Proposed rule: <rule>. Reason: <one line>.',
  symbol: <symbol>,
  tags: ['hindsight-check', '<verdict>']
})
```

## Honest caveats

- This skill is for **rule changes**, not strategy redesigns. If the operator is rethinking the whole strategy (e.g. "momentum doesn't work for me anymore"), use [[strategy-fit]] or [[backtest-validate]] instead.
- The skill assumes the trade had a recorded plan + synthesis manifest. Discretionary off-process trades can't be hindsight-checked — they have no decision-time substrate to compare against. That's a separate problem: the operator is trading without a recorded process.
- `HINDSIGHT_DESIRE` is not a moral judgment — the article's point is the version-who-knows has an unfair information set. Acknowledging that is the discipline. The operator can still notice the dimension and watch it on the next 10 trades before deciding it's a real signal. The rule is "do not change the system from one trade's outcome."
- Composes with [[exit-review]] (which surfaces the candidate trades to review) and [[replay-decision]] (which reconstructs the decision-time state in more detail). When in doubt, run those first to anchor the analysis.
