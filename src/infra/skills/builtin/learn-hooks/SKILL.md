---
name: learn-hooks
description: How to use lifecycle hooks for custom trading rules and automation. When user asks "how do I add a hook?", "custom rules", "event automation", "PreToolUse", "PreOrderPlacement", or about lifecycle hooks
tags: [learning, hooks, automation, customization]
user-invocable: true
---

Hooks let you inject custom rules at key points in Gordon's lifecycle. They're how you enforce trading policies without modifying code.

## 10 Hook Points

| Hook | When it fires | Use case |
|------|--------------|----------|
| **PreToolUse** | Before any tool executes | Block trades outside market hours |
| **PostToolUse** | After any tool completes | Log every order to external system |
| **PreCompact** | Before context compaction | Save critical data before it's summarized |
| **PostCompact** | After compaction completes | Restore caches |
| **SessionStart** | New session begins | Load user preferences |
| **Stop** | Agent stops (exit, error, interrupt) | Cleanup, final logging |
| **PreApproval** | Before showing approval dialog | Auto-approve small trades |
| **PostApproval** | After user decides | Record decision for audit |
| **PreOrderPlacement** | Before trade execution | Final risk check, size adjustment |
| **PostOrderPlacement** | After trade executes | Record outcome, update journal |

## Hook Actions

Each hook can return:
- **allow** — proceed normally
- **block** — stop execution, show reason to user
- **modify** — change the args/result (e.g., reduce position size)

## Example: Block After-Hours Trading

```
Register a hook at PreToolUse that:
- Filters for: place_order, place_limit_order, place_market_order
- Checks current time
- If outside 9:30 AM - 4:00 PM ET on weekdays → block
- Reason: "After-hours trading blocked by policy"
```

## Example: Auto-Approve Small Trades

```
Register a hook at PreApproval that:
- Checks if notionalUsd < $100
- If yes → return "allow" (skips the dialog)
- If no → return "allow" (let dialog show as normal)
```

## Example: Log Every Trade

```
Register a hook at PostOrderPlacement that:
- Captures: symbol, side, quantity, price, orderId
- Writes to ~/.gordon/trade-log.jsonl
- Always returns "allow" (never blocks)
```

## How to Register Hooks

Currently, hooks are registered programmatically via the hooks engine:
```
registerHook({
  id: "my-rule",
  point: "PreToolUse",
  priority: 10,
  toolFilter: "place_*",
  handler: async (payload) => { ... }
})
```

Future: GORDON.md will support declarative hook definitions.

## Viewing Active Hooks
Type `/hooks` to see all registered hooks with their IDs, points, and priorities.

## Priority
Lower priority number = runs first. Default is 100. If a hook blocks, later hooks don't run.

## Important
- Hook errors never crash the agent — they're caught and logged
- Hooks run serially (sorted by priority) at each point
- PreToolUse hooks can filter by tool name (exact, glob, or regex)
