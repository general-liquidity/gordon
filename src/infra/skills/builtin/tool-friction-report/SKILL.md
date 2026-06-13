---
name: tool-friction-report
description: "Report on tool-stack friction. When user says /tool-friction-report, 'which questions are costing me too many tool calls?', 'where are the tool-stack gaps?', or 'show me the high-friction turns from this week' — read the tool-friction review queue at ~/.gordon/tool-friction.jsonl, surface the user questions that crossed the friction threshold (default 5 tool calls per turn), and identify the most common tool sequences. Frames each high-friction turn as a candidate for a new specialized tool. Pure composition — no new tools, no new code."
arguments: [since?]
argument-hint: Optional ISO date or relative period (e.g., '2026-05-22', '7d', '24h'). Default: last 7 days.
tags: [review, tooling, telemetry, agentic-search]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Report on tool-stack friction — the operational signal Monigatti's "Agentic Search for Context Engineering" workshop identifies as the tell that a tool stack has a gap. The thesis from the article: **"four or five tool calls for a simple question often means the current tool is too hard for the model."** Gordon now records per-turn tool-call counts and fires a `tool_friction_observed` event when a turn crosses the threshold (default 5). This skill consumes those records and surfaces what to act on.

This is a pure-composition skill. The data lives at `~/.gordon/tool-friction.jsonl` (override via `GORDON_TOOL_FRICTION_PATH`) and is also emitted as `agent.tool_friction_observed` structured observations in the audit log.

## Step 1: Pull the friction events

```
audit_event lookups for eventType = 'agent.tool_friction_observed' since <since-or-7d-ago>
```

Or read the jsonl directly via the shell if available:

```
cat ~/.gordon/tool-friction.jsonl
```

Each event contains:
- `observedAt` — when the threshold was crossed
- `threadId` — which conversation
- `userMessage` — the question (if captured at turn start)
- `toolNames` — the tool sequence in order
- `count` — number of tool calls at fire time
- `threshold` — what was configured
- `turnDurationMs` — how long the turn ran before firing

If the file is empty / no events surface, tell the operator: "No friction events recorded in the window. Either the tool stack is well-fit OR the tracker is not seeing tool calls. Check `GORDON_TOOL_FRICTION_THRESHOLD` (default 5) — lowering it to 3 will surface more candidates while you bootstrap."

## Step 2: Cluster by tool sequence

Group events by their tool sequence (`toolNames` joined). The most common sequences are the highest-value gaps to fix — if the agent keeps calling the same 5-step chain to answer a class of question, that chain should collapse into one specialized tool.

For each cluster:
- Sequence (e.g., `get_market_data → compute_indicator → compute_indicator → compute_risk → memory_search`)
- Number of times it appeared
- Sample user questions that triggered it
- Average turn duration

Order clusters by frequency, descending. Top 5 is enough.

## Step 3: Recommend specialized tools (or skills)

For each top-3 cluster, propose:

**(a) Is this a candidate for a new specialized tool?**
If the sequence is deterministic (same calls, same shape, just different parameters), the right move is to fold the chain into one tool whose parameters describe the *intent* rather than the *steps*. Surface the proposed tool name + signature.

**(b) Is this a candidate for a new skill?**
If the sequence is workflow-like (each call depends on the previous result), a skill is better than a tool — the LLM still drives, but the skill teaches the chain shape so the model doesn't have to rediscover it on each turn. Surface the proposed skill name + steps.

**(c) Is this a sign the wrong tool is being selected?**
If the friction is from the agent picking the wrong tool first, then retrying — the fix is a better tool description on the *correct* tool, not a new tool. Surface which existing tool's description should be tightened.

**(d) Is this a sign the question is genuinely complex?**
Some questions legitimately need 5+ tools (multi-symbol portfolio review, cross-venue arbitrage check). Don't propose to compress these — flag them as "expected high-friction" and move on. The operator can decide whether to raise the threshold for that class of question.

## Step 4: Output a punch list

Present the report as a concise table:

| Rank | Tool sequence | Count | Example question | Recommendation |
|---|---|---|---|---|
| 1 | A → B → C → D → E | 14 | "..." | Fold into specialized tool `do_X` |
| 2 | F → G → F → G → H | 9 | "..." | Workflow — promote to skill `/Y` |
| 3 | get_news → memory_search → get_news → ... | 6 | "..." | Tighten `get_news` description |

Then ask the operator: "Which of these do you want to act on first?"

## Step 5: Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'tool-friction report: <N> events in window, top cluster <X> appeared <C> times',
  parameters: { window, total_events, top_clusters: [{ sequence, count }, ...] }
})
```

Do NOT auto-promote any of the recommendations to actual tools or skills — those are operator decisions. The skill produces analysis, not commits.

## Honest caveats

- **The data depends on wire-up.** If `recordUserTurnStart` is not being called on user-message receipt, the heuristic 30s idle-reset substitutes. That's good enough for catching obvious friction but misses sub-30s "different question, same session" cases. Worth checking the orchestrator integration before drawing strong conclusions.
- **Threshold tuning is the operator's job.** Default 5 is the article's number. Project-specific work (multi-leg backtests, portfolio review across 20 symbols) legitimately needs more tools. Calibrate per workflow if needed.
- **Dedup is per-turn, not per-session.** A long session with many high-friction turns will produce many events. That's intentional — each turn is a separate signal.
- Composes with [[exit-review]] (per-session retrospectives): a weak tool description flagged here is the one actually hurting in production — fix those first.
