---
name: agent-health
description: "Self-maintenance audit — aggregate every friction/feedback/eval queue plus staleness signals into one maintenance punch-list. When user says /agent-health, 'what needs maintaining?', 'audit the agent', 'what's decaying?', 'what should I build or fix next', 'weekly agent checkup', or wants the infrastructure-side review (NOT the trading P&L review — that's /weekend-review) — read the review queues, run the staleness checkers, and produce a classified punch-list: build-new-tool / fix-existing / re-review-skill / prune. Pure composition — no new code."
arguments: [since?]
argument-hint: Optional window for the queues (e.g. '7d', '30d'). Default 7 days.
tags: [review, maintenance, infrastructure, self-improvement]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Run the agent's **self-maintenance audit** — the infrastructure-side checkup, distinct from `/weekend-review` (which audits trading P&L). The thesis from "21 painful mistakes building AI agents": you need a self-thinking layer that *notices friction, failed runs, missing tools, and recurring bottlenecks* (#7), agents *decay if you don't maintain them* (#15), and the magic is in the *boring infrastructure* — clean inputs, monitoring, recovery, evals, cost control (#19). Gordon already collects all the raw signals; this skill is the synthesizer nothing else runs.

**Auto-think before auto-build.** The output is a punch-list of what's worth maintaining or building — NOT a licence to build. Surface the friction; let the operator decide what graduates into work.

This is a pure-composition skill. No new code — it reads existing review queues and runs the existing audit scripts.

## Step 1: Drain the review queues

Each queue is a JSONL fail-bucket under `~/.gordon/` (paths overridable via env). Read each, filtered to the window:

| Queue | File (env override) | What it means |
|---|---|---|
| Tool friction | `~/.gordon/tool-friction.jsonl` (`GORDON_TOOL_FRICTION_PATH`) | Turns that needed too many tool calls → tool-stack gap. Cross-ref [[tool-friction-report]] for the deep read. |
| Agent feedback | `~/.gordon/agent-feedback.jsonl` (`GORDON_AGENT_FEEDBACK_PATH`) | The agent self-reported stuck-ness (intent + attempts + blocker). |
| Eval failures | `~/.gordon/eval-failures.jsonl` (`GORDON_EVAL_REVIEW_QUEUE_PATH`) | Regressions from the eval harness. |
| Goal deferred | `~/.gordon/goal-deferred.jsonl` | Goals the autonomous loop chose NOT to pursue — recurring deferrals signal a missing capability. |
| Backtest experiments | `~/.gordon/backtest-experiments.jsonl` | Strategy experiments logged but not promoted. |

For each queue: count entries in the window, cluster by repeated signature (same tool sequence, same blocker, same failing scenario). **Repetition is the signal** — one occurrence is noise, a cluster is a bottleneck.

If a file is absent, say "no entries" and move on — absence is healthy, not an error.

## Step 2: Run the tier checker + eyeball staleness

Run the deterministic checker and read the output (suggest the operator run it via `!` if the skill can't shell out):

```
bun run scripts/dev/checks/check_tool_tiers.ts              # untiered hot-tier additions
```

Then eyeball the two manual signals (their standalone audit scripts were retired):
- **Skill staleness** — built-in `SKILL.md` files whose `last-reviewed` frontmatter is past ~90 days, or missing the field.
- **Weak tool descriptions** — one-line / sub-80-char tool descriptions with no "use when" trigger conditions.

Also check **MCP discovery cache age** — `src/infra/ai/mcp/discoveryCache.ts` carries a 24h TTL; descriptors older than that for a server still in use are a staleness signal after an MCP update.

## Step 3: Correlate friction with staleness

The highest-value items appear in **both** a friction queue AND a staleness checker:
- A tool that shows up in `tool-friction.jsonl` AND has a weak / one-line description → its description is actively hurting. Fix the description first (cheapest), re-measure.
- A skill that's stale AND whose tools moved (tier audit / surface changes since its `last-reviewed`) → re-review against the current surface before trusting it.
- A blocker in `agent-feedback.jsonl` that recurs across windows AND maps to no existing tool → genuine missing-tool signal (#7's "missing tools").

## Step 4: Produce the classified punch-list

Present one table. Classify each item:

| Item | Signal source(s) | Class | Recommendation |
|---|---|---|---|
| `get_news` weak desc + 6 friction turns | descriptions + friction | **fix-existing** | Tighten description; re-measure friction next week |
| 4× recurring "no tool for X" blocker | agent-feedback | **build-new-tool** | Scope a specialized tool for X |
| `arb-funding` stale 120d, surface moved | staleness | **re-review-skill** | Re-validate against current tool names, bump last-reviewed |
| `backtest-experiments` 30 entries, 0 promoted | backtest queue | **prune** | Archive or promote; the queue is accreting noise |

Classes:
- **build-new-tool** — recurring friction/blocker that maps to no existing capability (#7 missing tools). The bar is *repetition*, not a single miss.
- **fix-existing** — a tool/skill exists but is mis-described, mis-tiered, or buggy (cheapest fixes; do these first).
- **re-review-skill** — stale skill whose dependencies likely moved.
- **prune** — a queue or artifact that's accreting without being acted on (a queue with no consumer is just a dashboard).

Order by leverage: cheap fixes that resolve repeated friction first; speculative new builds last.

## Step 5: Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'agent-health audit: <N> friction items, <M> stale skills, top class <X>',
  parameters: { window, friction_count, feedback_count, eval_failures, stale_skills, weak_descriptions, punch_list: [{ item, class }] }
})
```

Do NOT auto-execute any punch-list item. This audit produces analysis; builds are separate, operator-gated decisions (the article's #7 — auto-think before auto-build).

## Honest caveats

- **Repetition is the bar.** A single friction turn or one deferred goal is noise. Only clusters justify a punch-list item — otherwise you'll build tools for one-off questions and bloat the surface (the exact thing the tier convention guards against).
- **Cheapest fix first.** A weak tool description hurting in production is a one-line fix that may dissolve the friction entirely — try it before building a new tool. The /agent-health → fix-description → re-measure loop is the article's "auto-think before auto-build" in practice.
- **Absence is health.** Empty queues and all-fresh skills mean the maintenance is current. Report that plainly; don't manufacture work.
- **This is infra, not trading.** P&L, patterns, and risk live in [[weekend-review]]. Keep the two reviews separate — conflating them buries infrastructure decay under trading noise.
- Composes with [[tool-friction-report]] (the deep read on the friction queue), [[hindsight-check]] (whether a proposed change is legitimate), and the three dev audit scripts. Run weekly, or after any tool/model/MCP/workflow change.
