---
id: best-practices
title: Gordon Best Practices
description: How to get the most out of Gordon — patterns, workflows, and traps to avoid
---

# Gordon Best Practices

This is the field guide for using Gordon effectively. Read before starting a live trading session, after an incident, or whenever Gordon feels like it isn't behaving the way you expect.

## 1. Pick the Right Permission Mode for the Task

Gordon has six permission modes. Most frustration comes from being in the wrong one.

| Mode | Use When | Don't Use When |
|------|----------|----------------|
| **/ask** | Default for any live trading | You're running an autonomous mandate |
| **/auto** | Running a validated strategy or autonomous loop | You're still experimenting — use /paper |
| **/strict** | Pure research, no trade intent | You want to actually execute |
| **/paper** | Validating a new strategy before going live | You need real fills (slippage, borrow, etc. differ) |
| **/observe** | Auditing Gordon's reasoning, demo walkthroughs | You want Gordon to produce plans |
| **/planmode** | Building a playbook to review later | You want execution now |

**Rule of thumb**: start in `/ask` for any new workflow, move to `/auto` only after you've validated the behavior in `/paper`.

## 2. Use Skills Before Complex Workflows

Before running a workflow you haven't done in a while, pull the skill:
- `list_skills` → see what's available
- `load_skill <id>` → get the canonical flow (dd, swing-entry, rebalance, weekend-review, etc.)

Gordon's instructions stay lean by pushing workflow details into skill markdowns. Loading the skill is how you ground Gordon in the correct approach before any steps begin.

## 3. Plan → Validate → Execute (The Golden Loop)

The most reliable way to trade with Gordon is a three-step loop:
1. **Plan**: have Gordon create a plan (`/plan BTCUSDT` or a dd workflow)
2. **Validate**: run the risk gate (`check_risk`), check constitution, preview the order
3. **Execute**: only after the first two steps pass

Don't skip step 2. The risk gate catches things the LLM misses (correlation limits, drawdown caps, leverage constraints).

## 4. Treat Radar as an Assistant, Not an Oracle

Radar mode surfaces unsolicited suggestions — earnings approaching, insider flow alerts, regime flips, analyst upgrades, whale moves. They're prompts for your attention, not pre-approved trades.

- **Ack a suggestion** (`/ack <id>`) only after you've validated the setup yourself
- **Pass** (`/pass <id>`) freely — false positives are expected, they shape future frequency
- **Snooze a category** (`/snooze <category>`) during noisy periods
- Check `get_producer_health` if radar goes quiet — silent producers usually mean upstream outages, not that the market is calm

## 5. Record Confidence at Decision Time, Not After

The calibration system is only useful if you record confidence **before** you know the outcome.
- **record_confident_decision** right after making the call
- **record_decision_outcome** once the outcome is known
- **get_calibration_stats** periodically to see which buckets are over- or under-confident

If you skip the first step, you're just recording hindsight — which doesn't calibrate anything. The whole point is catching the gap between your stated confidence and your actual accuracy.

## 6. Let the Constitution Do Its Job

The trading constitution enforces automatic halts you cannot override from chat:
- **Daily loss halt** at 3%
- **Drawdown halt** at 10%
- **Emergency liquidation** at 15%
- **Consecutive loss halt** at 5 losing trades → 24h cooldown
- **Flash crash protection** at 2% loss in 15 minutes

When a halt fires, **don't try to work around it**. Halts exist precisely for the moment your judgment is worst. Wait out the cooldown, review what happened, and come back in `/paper` or `/strict` to rebuild confidence.

## 7. Keep Context Clean with the Right Tools

Gordon will compact context automatically (masking → pruning → aggressive → full summary), but you can help it:
- Use `search_memory` to pull specific lessons instead of dumping full history
- Use `read_shared_context` for cross-agent coordination instead of re-fetching
- Use `/loop` and `/research` sparingly — they eat context fast
- Skill-load on demand rather than pasting workflow text into chat

If Gordon starts hallucinating function names or forgetting earlier context, you've probably crossed 80% context fill. Start a fresh session.

## 8. Use Shared Context for Handoffs

When running a multi-step workflow (e.g., Scanner → Analyst → Planner), use `write_shared_context` and `read_shared_context` instead of re-deriving state. Agents can hand off analysis via versioned context entries with TTL cleanup.

This is especially useful for:
- Scanner finding an opportunity → Planner building the entry plan
- Analyst computing indicators → Risk gate evaluating them
- Researcher backtesting → Planner deploying the best variant

## 9. Use Hooks for Policies, Not Suggestions

Hooks run before every tool call and can block, modify, or allow. Good hook use cases:
- **PreToolUse**: block trading outside market hours, reduce size when in drawdown
- **PreOrderPlacement**: final risk check, compliance logging, size adjustment
- **PostOrderPlacement**: write to trade journal, notify external systems

Bad hook use cases:
- Anything the LLM should decide case-by-case (use skills/prompts instead)
- Anything you want to disable easily (hooks are silent — users forget they exist)

Run `/hooks` to list active hooks. Lower priority = runs first.

## 10. Own Your Data

Gordon runs locally. Your data stays on your machine:
- `~/.gordon/memory.db` — trade journal, observations, insights
- `~/.gordon/gordon.db` — Mastra thread state
- `~/.gordon/calibration.jsonl` — confidence calibration log
- `~/.gordon/backtest-experiments.jsonl` — research journal
- `~/.gordon/config.json` — settings

Back these up before upgrading Gordon. Especially the calibration and experiments files — they accumulate signal over time.

## 11. When Things Feel Wrong, Switch Modes and Audit

If Gordon is suggesting trades you don't trust, or the UI feels off, or a workflow isn't producing the usual output:
1. Switch to `/observe` — this immediately stops any execution surface
2. Run `get_audit_stats` and `query_audit_trail` — see the decision path
3. Check `get_producer_health` — are the proactive producers alive?
4. Check `get_calibration_stats` — is the recent accuracy matching the stated confidence?
5. If nothing looks wrong in audit, it might be a model drift — try the fallback model via `/model`

## 12. Read the Learn Skills Before Asking for Help

Gordon has a full set of learn-* skills covering every subsystem:
- `/learn-agents` — the 4-agent architecture
- `/learn-permissions` — all 6 permission modes
- `/learn-hooks` — the 10 hook points
- `/learn-memory` — memory, shared context, calibration
- `/learn-risk` — the risk kernel and constitution
- `/learn-backtest` — backtest loop and research mode
- `/learn-commands` — slash command reference
- `/learn-execution` — trade execution path
- `/learn-config` — settings and config layers
- `/learn-portfolio` — position tracking, P&L, drawdown
- `/learn-mcp` — MCP integrations
- `/learn-analysis` — indicators, patterns, regime
- `/learn-skills` — how the skill system works

Most questions already have a skill answer. Load it first.

## Anti-Patterns to Avoid

- **Overriding the risk gate** — don't `check_risk` then ignore the result
- **Running `/auto` on a new strategy** — validate in `/paper` first
- **Ignoring producer health warnings** — silent producers hide broken pipelines
- **Never recording decision outcomes** — calibration is worthless without pairing
- **Keeping a session alive for days** — summary regeneration degrades; start fresh
- **Pasting long reference docs into chat** — use skills and shared context
- **Treating radar suggestions as trade signals** — they're prompts, not pre-approved setups
- **Not backing up `~/.gordon/`** — years of calibration data can vanish in one rm

## One-Line Summary

Plan in `/paper`, execute in `/ask`, audit in `/observe`, never override the constitution.
